'use strict';

// push/pull 계열 명령 — push(force)/pull/force-pull/브랜치 pull + 원격 사전확인/rebase.

const vscode = require('vscode');
const { t, isKo } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { getCurrentBranch, isDetachedHead, hasInProgressOperation } = require('../git/queries');
const { createRebaseBackupIfEnabled, rebaseBackupNote } = require('../features/backup');
const { handleGitError } = require('./error');

async function execPush(force) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHeadPush'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);

  if (force) {
    const confirm = await vscode.window.showWarningMessage(
      t('forcePushConfirm', currentBranch),
      { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  await performPush(cwd, currentBranch, force);
}

async function performPush(cwd, currentBranch, force) {
  let hasUpstream = true;
  try {
    await execGitSilent(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`], cwd);
  } catch {
    hasUpstream = false;
  }

  // 일반 push이고 upstream이 있으면, 원격에 로컬에 없는 커밋이 있는지 확인 후 rebase 선택지 제공
  if (!force && hasUpstream) {
    const decision = await checkRemoteBeforePush(cwd, currentBranch);
    if (decision === 'cancel') return;       // 사용자가 취소
    if (decision === 'rebase-only') return;  // rebase만 하고 push 안 함
    // 'push' | 'rebase-push' 는 아래에서 push 진행
  }

  const pushArgs = ['push'];
  if (force) pushArgs.push('--force');
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

async function execPull() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHead'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);
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
  execPush, performPush, execPull, execForcePull, execBranchPull, execForceBranchPull,
};
