'use strict';

// 명령 팔레트 핸들러 (하위 호환) — QuickPick 기반 rebase/merge/pull/push/commit/reset/cherry-pick/history.

const vscode = require('vscode');
const path = require('path');
const { t, isKo } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const {
  getCurrentBranch, isDetachedHead, hasInProgressOperation,
  getLocalBranches, getRemoteBranches, fetchAll, ensureRemoteBranchFetched, getCommitLog,
} = require('../git/queries');
const { showBranchPicker, showActionPicker, showPullActionPicker, showCommitPicker } = require('../ui/pickers');
const { createRebaseBackupIfEnabled, rebaseBackupNote } = require('../features/backup');
const { handleGitError } = require('./error');
const { performPush } = require('./push-pull');
const { copyShortHash, copyCommitMessage } = require('./diff');

async function rebaseMerge(remote) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showWarningMessage(t('detachedHeadWarn'));
  }

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') { vscode.window.showWarningMessage(t('inProgressRebase')); return; }
  if (inProgress === 'merge') { vscode.window.showWarningMessage(t('inProgressMerge')); return; }

  if (remote) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('fetchingRemotes') },
      () => fetchAll(cwd)
    );
  }

  const currentBranch = await getCurrentBranch(cwd);
  const branches = remote
    ? await getRemoteBranches(cwd)
    : (await getLocalBranches(cwd)).filter(b => b.name !== currentBranch);

  if (branches.length === 0) { vscode.window.showInformationMessage(t('noBranches')); return; }

  const selectedBranch = await showBranchPicker(branches, currentBranch);
  if (!selectedBranch) return;

  if (remote) {
    try {
      await ensureRemoteBranchFetched(cwd, selectedBranch);
    } catch (err) {
      vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
      return;
    }
  }

  const action = await showActionPicker(selectedBranch);
  if (!action) return;

  const confirmMsg = action === 'rebase'
    ? t('confirmRebase', currentBranch, selectedBranch)
    : t('confirmMerge', currentBranch, selectedBranch);
  const detail = action === 'rebase'
    ? (isKo
      ? `현재 브랜치(${currentBranch})의 커밋들을 ${selectedBranch} 브랜치 위로 재배치합니다.\n커밋 히스토리가 깔끔해지지만, 기존 커밋 해시가 변경됩니다.`
      : `Replays commits from ${currentBranch} on top of ${selectedBranch}.\nCreates a linear history but changes existing commit hashes.`)
    : (isKo
      ? `${selectedBranch} 브랜치의 변경사항을 현재 브랜치(${currentBranch})에 합칩니다.\n머지 커밋이 생성되며, 양쪽 히스토리가 보존됩니다.`
      : `Integrates changes from ${selectedBranch} into ${currentBranch}.\nCreates a merge commit, preserving both branch histories.`);
  const actionLabel = action === 'rebase'
    ? t('rebaseOnto', selectedBranch)
    : t('mergeInto', currentBranch);
  const confirm = await vscode.window.showWarningMessage(
    confirmMsg, { modal: true, detail: detail + rebaseBackupNote(action) }, actionLabel
  );
  if (confirm !== actionLabel) return;

  const gitArgs = action === 'rebase'
    ? ['rebase', selectedBranch]
    : ['merge', '--no-edit', selectedBranch];
  const gitCmd = `git ${gitArgs.join(' ')}`;

  if (action === 'rebase') {
    await createRebaseBackupIfEnabled(cwd, currentBranch);
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', gitCmd) },
      () => execGit(gitArgs, cwd)
    );
    try {
      const { stdout } = await execGitSilent(['rev-list', '--count', `${selectedBranch}..HEAD`], cwd);
      vscode.window.showInformationMessage(t('successWithCount', gitCmd, stdout.trim()));
    } catch {
      vscode.window.showInformationMessage(t('success', gitCmd));
    }
  } catch (err) {
    await handleGitError(err, action, cwd);
  }
}

async function pullBranch() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) { vscode.window.showErrorMessage(t('detachedHead')); return; }

  const currentBranch = await getCurrentBranch(cwd);
  const branches = await getLocalBranches(cwd);
  if (branches.length === 0) { vscode.window.showInformationMessage(t('noBranches')); return; }

  const selectedBranch = await showBranchPicker(branches, currentBranch);
  if (!selectedBranch) return;

  const pullAction = await showPullActionPicker();
  if (!pullAction) return;

  if (selectedBranch === currentBranch) {
    const pullArgs = pullAction === 'pull-rebase' ? ['pull', '--rebase'] : ['pull'];
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${pullArgs.join(' ')}`) },
        () => execGit(pullArgs, cwd)
      );
      vscode.window.showInformationMessage(t('pullSuccess', selectedBranch));
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
    return;
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch origin ${selectedBranch}`) },
      () => execGit(['fetch', 'origin', `${selectedBranch}:${selectedBranch}`], cwd, { timeout: 30000 })
    );
    vscode.window.showInformationMessage(t('pullSuccess', selectedBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    if (/non-fast-forward|rejected/i.test(msg)) {
      vscode.window.showWarningMessage(t('branchDiverged', selectedBranch));
    } else {
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
  }
}

async function pushBranch() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) { vscode.window.showErrorMessage(t('detachedHeadPush')); return; }

  const currentBranch = await getCurrentBranch(cwd);

  const pushItems = [
    { label: `$(cloud-upload) ${t('push')}`, value: 'push' },
    { label: `$(warning) ${t('pushForce')}`, value: 'force' },
  ];
  const pushAction = await vscode.window.showQuickPick(pushItems, { placeHolder: t('selectAction') });
  if (!pushAction) return;

  const force = pushAction.value === 'force';
  if (force) {
    const confirm = await vscode.window.showWarningMessage(
      t('forcePushConfirm', currentBranch), { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  await performPush(cwd, currentBranch, force);
}

async function commitChanges() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const { stdout: statusOut } = await execGitSilent(['status', '--porcelain'], cwd);
  if (!statusOut.trim()) { vscode.window.showInformationMessage(t('noChanges')); return; }

  const lines = statusOut.trimEnd().split('\n');
  const fileItems = lines.map(line => {
    const indexStatus = line[0];
    const workStatus = line[1];
    const filePath = line.substring(3);
    const isStaged = indexStatus !== ' ' && indexStatus !== '?';
    const statusIcons = { M: '$(edit)', A: '$(add)', D: '$(trash)', '?': '$(question)', R: '$(arrow-right)' };
    const statusCode = isStaged ? indexStatus : (workStatus === '?' ? '?' : workStatus);
    const icon = statusIcons[statusCode] || '$(file)';
    return { label: `${icon} ${filePath}`, description: isStaged ? 'staged' : 'unstaged', filePath, picked: isStaged };
  });

  const selected = await vscode.window.showQuickPick(fileItems, { placeHolder: t('selectFiles'), canPickMany: true });
  if (!selected || selected.length === 0) return;

  const pastMessages = await getCommitLog(cwd, { count: 20 });
  const msgItems = [
    { label: t('newMessage'), value: '__new__' },
    ...pastMessages.map(c => ({ label: c.message, description: `${c.author}  ${c.date}`, value: c.message })),
  ];
  const msgChoice = await vscode.window.showQuickPick(msgItems, { placeHolder: t('selectCommitMsg') });
  if (!msgChoice) return;

  let commitMessage;
  if (msgChoice.value === '__new__') {
    commitMessage = await vscode.window.showInputBox({ prompt: t('enterCommitMsg'), placeHolder: t('enterCommitMsg') });
    if (!commitMessage) return;
  } else {
    commitMessage = msgChoice.value;
  }

  try {
    try { await execGit(['reset', 'HEAD'], cwd); } catch { /* initial commit */ }
    // -f로 강제 추가한 ignore 파일도 다시 스테이징되도록 --force 사용
    await execGit(['add', '--force', '--', ...selected.map(s => s.filePath)], cwd);
    await execGit(['commit', '-m', commitMessage], cwd);
    vscode.window.showInformationMessage(t('commitSuccess', commitMessage));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function resetCommit() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const modeItems = [
    { label: `$(history) ${t('resetSoft')}`, value: '--soft' },
    { label: `$(warning) ${t('resetHard')}`, value: '--hard' },
  ];
  const modeChoice = await vscode.window.showQuickPick(modeItems, { placeHolder: t('selectResetMode') });
  if (!modeChoice) return;

  const commit = await showCommitPicker(cwd, { title: t('selectCommit') });
  if (!commit) return;

  if (modeChoice.value === '--hard') {
    const confirm = await vscode.window.showWarningMessage(
      t('confirmHardReset', commit.hash.substring(0, 8)), { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  try {
    await execGit(['reset', modeChoice.value, commit.hash], cwd);
    vscode.window.showInformationMessage(t('resetSuccess', commit.hash.substring(0, 8)));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function cherryPick() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') { vscode.window.showWarningMessage(t('inProgressRebase')); return; }
  if (inProgress === 'merge') { vscode.window.showWarningMessage(t('inProgressMerge')); return; }
  if (inProgress === 'cherry-pick') { vscode.window.showWarningMessage(t('inProgressCherryPick')); return; }

  const currentBranch = await getCurrentBranch(cwd);
  const branches = (await getLocalBranches(cwd)).filter(b => b.name !== currentBranch);
  if (branches.length === 0) { vscode.window.showInformationMessage(t('noBranches')); return; }

  const selectedBranch = await showBranchPicker(branches, currentBranch);
  if (!selectedBranch) return;

  const commit = await showCommitPicker(cwd, { branch: selectedBranch, title: t('selectCommit') });
  if (!commit) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git cherry-pick ${commit.hash.substring(0, 8)}`) },
      () => execGit(['cherry-pick', commit.hash], cwd)
    );
    vscode.window.showInformationMessage(t('cherryPickSuccess', commit.hash.substring(0, 8)));
  } catch (err) {
    await handleGitError(err, 'cherry-pick', cwd);
  }
}

async function showHistory() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const commit = await showCommitPicker(cwd, { title: t('historyTitle') });
  if (!commit) return;

  const actionItems = [
    { label: t('copyHash'), value: 'copy' },
    { label: t('copyMessage'), value: 'copyMessage' },
    { label: t('viewDiff'), value: 'diff' },
    { label: t('cherryPickAction'), value: 'cherry-pick' },
    { label: t('resetToHere'), value: 'reset' },
  ];
  const action = await vscode.window.showQuickPick(actionItems, { placeHolder: t('selectHistoryAction') });
  if (!action) return;

  if (action.value === 'copy') {
    await copyShortHash(commit.hash);
    return;
  }

  if (action.value === 'copyMessage') {
    await copyCommitMessage(commit.hash);
    return;
  }

  if (action.value === 'diff') {
    try {
      const { stdout } = await execGit(['diff-tree', '--no-commit-id', '-r', '--name-only', commit.hash], cwd);
      const files = stdout.trim().split('\n').filter(Boolean);
      if (files.length === 0) { vscode.window.showInformationMessage(t('noDiffFiles')); return; }

      const fileItems = files.map(f => ({ label: f }));
      const selectedFile = await vscode.window.showQuickPick(fileItems, { placeHolder: t('selectFile') });
      if (!selectedFile) return;

      const commitUri = vscode.Uri.parse(
        `gitreflow://show/${commit.hash}/${selectedFile.label}?cwd=${encodeURIComponent(cwd)}`
      );
      const workingUri = vscode.Uri.file(path.join(cwd, selectedFile.label));
      await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri,
        `${selectedFile.label} (${commit.hash.substring(0, 8)} vs Working)`);
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
    return;
  }

  if (action.value === 'cherry-pick') {
    const inProgress = await hasInProgressOperation(cwd);
    if (inProgress) {
      const msgKey = inProgress === 'rebase' ? 'inProgressRebase'
        : inProgress === 'cherry-pick' ? 'inProgressCherryPick' : 'inProgressMerge';
      vscode.window.showWarningMessage(t(msgKey));
      return;
    }
    try {
      await execGit(['cherry-pick', commit.hash], cwd);
      vscode.window.showInformationMessage(t('cherryPickSuccess', commit.hash.substring(0, 8)));
    } catch (err) {
      await handleGitError(err, 'cherry-pick', cwd);
    }
    return;
  }

  if (action.value === 'reset') {
    const modeItems = [
      { label: `$(history) ${t('resetSoft')}`, value: '--soft' },
      { label: `$(warning) ${t('resetHard')}`, value: '--hard' },
    ];
    const modeChoice = await vscode.window.showQuickPick(modeItems, { placeHolder: t('selectResetMode') });
    if (!modeChoice) return;

    if (modeChoice.value === '--hard') {
      const confirm = await vscode.window.showWarningMessage(
        t('confirmHardReset', commit.hash.substring(0, 8)), { modal: true }, t('yes')
      );
      if (confirm !== t('yes')) return;
    }

    try {
      await execGit(['reset', modeChoice.value, commit.hash], cwd);
      vscode.window.showInformationMessage(t('resetSuccess', commit.hash.substring(0, 8)));
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
  }
}

module.exports = {
  rebaseMerge, pullBranch, pushBranch, commitChanges, resetCommit, cherryPick, showHistory,
};
