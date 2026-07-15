'use strict';

// push/pull 계열 명령 — push(force)/pull/force-pull/브랜치 pull + 원격 사전확인/rebase.

const vscode = require('vscode');
const { t, isKo } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { getCurrentBranch, isDetachedHead, hasInProgressOperation } = require('../git/queries');
const { createRebaseBackupIfEnabled, rebaseBackupNote } = require('../features/backup');
const { handleGitError } = require('./error');

// push 모드
//   normal — 일반 push. 원격에 새 커밋이 있으면 rebase 선택지를 먼저 제공한다.
//   lease  — --force-with-lease. 원격이 내가 마지막으로 받아둔 상태 그대로일 때만 덮어쓴다.
//            그 사이 다른 사람이 push 했다면 거부되므로, 재작성한 히스토리를 올릴 때 안전하다.
//   force  — --force. 원격 상태와 관계없이 무조건 덮어쓴다.
const PUSH_FLAG = { lease: '--force-with-lease', force: '--force' };
const PUSH_CONFIRM = { lease: 'leasePushConfirm', force: 'forcePushConfirm' };

// 원격을 덮어쓰는 push(lease/force)는 모달로 확인받는다. 진행해도 되면 true.
async function confirmPushMode(mode, currentBranch) {
  const key = PUSH_CONFIRM[mode];
  if (!key) return true;   // normal 은 확인 불필요
  const answer = await vscode.window.showWarningMessage(
    t(key, currentBranch), { modal: true }, t('yes')
  );
  return answer === t('yes');
}

async function execPush(mode = 'normal') {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHeadPush'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);

  if (!await confirmPushMode(mode, currentBranch)) return;

  await performPush(cwd, currentBranch, mode);
}

async function performPush(cwd, currentBranch, mode = 'normal') {
  let hasUpstream = true;
  try {
    await execGitSilent(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`], cwd);
  } catch {
    hasUpstream = false;
  }

  // 일반 push이고 upstream이 있으면, 원격에 로컬에 없는 커밋이 있는지 확인 후 rebase 선택지 제공.
  // lease/force 에서는 fetch 하지 않는다 — fetch 로 remote-tracking 을 갱신해 버리면
  // --force-with-lease 의 비교 기준이 최신화되어 보호 장치가 무력해진다.
  if (mode === 'normal' && hasUpstream) {
    const decision = await checkRemoteBeforePush(cwd, currentBranch);
    if (decision === 'cancel') return;       // 사용자가 취소
    if (decision === 'rebase-only') return;  // rebase만 하고 push 안 함
    // 'push' | 'rebase-push' 는 아래에서 push 진행
  }

  const pushArgs = ['push'];
  if (PUSH_FLAG[mode]) pushArgs.push(PUSH_FLAG[mode]);
  if (!hasUpstream) pushArgs.push('--set-upstream', 'origin', currentBranch);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${pushArgs.join(' ')}`) },
      () => execGit(pushArgs, cwd)
    );
    vscode.window.showInformationMessage(t('pushSuccess', currentBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function checkRemoteBeforePush(cwd, currentBranch) {
  // 최신 원격 상태 확인을 위해 fetch (실패하면 확인 불가 → 그냥 push 진행)
  try {
    const { stdout: remote } = await execGitSilent(['config', `branch.${currentBranch}.remote`], cwd);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('checkingRemote') },
      () => execGit(['fetch', remote.trim()], cwd, { timeout: 30000 })
    );
  } catch {
    return 'push';
  }

  let behind = 0;
  try {
    const { stdout } = await execGitSilent(['rev-list', '--count', 'HEAD..@{upstream}'], cwd);
    behind = parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 'push';
  }
  if (behind === 0) return 'push';

  const rebaseOnly = t('cancelAndRebase');
  const rebasePush = t('rebaseThenPush');
  const choice = await vscode.window.showWarningMessage(
    t('remoteHasCommits', behind),
    { modal: true, detail: t('remoteHasCommitsDetail') + rebaseBackupNote('rebase') },
    rebaseOnly, rebasePush
  );

  if (choice === rebaseOnly) {
    await rebaseOntoUpstream(cwd, currentBranch);
    return 'rebase-only';
  }
  if (choice === rebasePush) {
    const ok = await rebaseOntoUpstream(cwd, currentBranch);
    return ok ? 'rebase-push' : 'cancel'; // rebase 충돌/실패 시 push 안 함
  }
  return 'cancel';
}

async function rebaseOntoUpstream(cwd, currentBranch) {
  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') { vscode.window.showWarningMessage(t('inProgressRebase')); return false; }
  if (inProgress === 'merge') { vscode.window.showWarningMessage(t('inProgressMerge')); return false; }

  await createRebaseBackupIfEnabled(cwd, currentBranch);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', 'git rebase @{upstream}') },
      () => execGit(['rebase', '@{upstream}'], cwd)
    );
    vscode.window.showInformationMessage(t('success', 'git rebase'));
    return true;
  } catch (err) {
    await handleGitError(err, 'rebase', cwd);
    return false;
  }
}

// 로컬과 원격이 갈라졌는지 확인 — 양쪽 모두 상대에게 없는 커밋을 가진 상태.
// 여기서 fetch 는 하지 않는다. 히스토리를 재작성하면 로컬 커밋이 새 해시로 바뀌는 반면
// remote-tracking 은 옛 해시를 그대로 가리키므로, 그 자체로 즉시 갈라진 상태가 된다.
async function getDivergence(cwd) {
  try {
    const { stdout } = await execGitSilent(
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], cwd
    );
    const [ahead, behind] = stdout.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };   // upstream 이 없으면 판단 불가 → 평소대로 진행
  }
}

// 갈라진 상태에서 pull(merge) 하면 재작성 전의 옛 커밋이 원격에서 다시 들어와
// 같은 작업이 두 벌 들어간 히스토리가 만들어진다. 그대로 두면 에러 없이 조용히 벌어지므로
// pull 전에 막고, 이 상황에서 사용자가 정말 하려던 일(안전 강제 푸시)을 바로 제안한다.
// 계속 pull 해도 되면 true.
async function confirmPullWhenDiverged(cwd, currentBranch) {
  const { ahead, behind } = await getDivergence(cwd);
  if (ahead === 0 || behind === 0) return true;   // 갈라지지 않음 → 평범한 pull

  const leaseLabel = t('pushLease');
  const pullAnyway = t('pullAnyway');
  const choice = await vscode.window.showWarningMessage(
    t('divergedPullWarn', ahead, behind),
    { modal: true, detail: t('divergedPullDetail') },
    leaseLabel, pullAnyway
  );

  if (choice === leaseLabel) {
    if (!await confirmPushMode('lease', currentBranch)) return false;
    await performPush(cwd, currentBranch, 'lease');
    return false;   // push 했으므로 pull 은 하지 않는다
  }
  return choice === pullAnyway;
}

async function execPull() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHead'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);

  if (!await confirmPullWhenDiverged(cwd, currentBranch)) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', 'git pull') },
      () => execGit(['pull'], cwd)
    );
    vscode.window.showInformationMessage(t('pullSuccess', currentBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execForcePull() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHead'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);
  const confirm = await vscode.window.showWarningMessage(
    t('forcePullConfirm', currentBranch), { modal: true }, t('yes')
  );
  if (confirm !== t('yes')) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch + reset ${currentBranch}`) },
      async () => {
        await execGit(['fetch', 'origin', currentBranch], cwd);
        await execGit(['reset', '--hard', `origin/${currentBranch}`], cwd);
      }
    );
    vscode.window.showInformationMessage(t('pullSuccess', currentBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execBranchPull(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const currentBranch = await getCurrentBranch(cwd);

  try {
    if (branchName === currentBranch) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git pull origin ${branchName}`) },
        () => execGit(['pull', 'origin', branchName], cwd)
      );
    } else {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch origin ${branchName}`) },
        async () => {
          await execGit(['fetch', 'origin', `${branchName}:${branchName}`], cwd);
        }
      );
    }
    vscode.window.showInformationMessage(t('pullSuccess', branchName));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execForceBranchPull(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const currentBranch = await getCurrentBranch(cwd);
  const msg1 = isKo
    ? `${branchName} 브랜치를 강제로 원격에서 가져옵니다. 로컬 변경사항이 사라집니다. 계속하시겠습니까?`
    : `Force pull ${branchName} from remote. Local changes will be lost. Continue?`;
  const confirm1 = await vscode.window.showWarningMessage(msg1, { modal: true }, t('yes'));
  if (confirm1 !== t('yes')) return;

  const msg2 = isKo
    ? `정말로 ${branchName} 브랜치를 강제로 덮어쓰시겠습니까? 이 작업은 되돌릴 수 없습니다.`
    : `Are you absolutely sure you want to overwrite ${branchName}? This cannot be undone.`;
  const confirm2 = await vscode.window.showWarningMessage(msg2, { modal: true }, t('yes'));
  if (confirm2 !== t('yes')) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch + reset ${branchName}`) },
      async () => {
        await execGit(['fetch', 'origin', branchName], cwd);
        if (branchName === currentBranch) {
          await execGit(['reset', '--hard', `origin/${branchName}`], cwd);
        } else {
          await execGit(['branch', '-f', branchName, `origin/${branchName}`], cwd);
        }
      }
    );
    vscode.window.showInformationMessage(
      isKo ? `${branchName} 브랜치를 강제로 가져왔습니다.` : `Force pulled ${branchName} successfully.`
    );
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

module.exports = {
  execPush, performPush, confirmPushMode,
  execPull, execForcePull, execBranchPull, execForceBranchPull,
};
