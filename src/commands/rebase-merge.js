'use strict';

// rebase/merge 명령 — 선택 브랜치 위로 rebase 또는 머지(백업·충돌 처리 포함).

const vscode = require('vscode');
const { t, isKo } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { getCurrentBranch, isDetachedHead, hasInProgressOperation, ensureRemoteBranchFetched } = require('../git/queries');
const { createRebaseBackupIfEnabled, rebaseBackupNote } = require('../features/backup');
const { handleGitError } = require('./error');

async function execRebaseMerge(item, action) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showWarningMessage(t('detachedHeadWarn'));
  }

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') {
    vscode.window.showWarningMessage(t('inProgressRebase'));
    return;
  }
  if (inProgress === 'merge') {
    vscode.window.showWarningMessage(t('inProgressMerge'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);
  const selectedBranch = item.branchName;

  if (item.unfetched) {
    try {
      await ensureRemoteBranchFetched(cwd, selectedBranch);
      item.unfetched = false;
    } catch (err) {
      vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
      return;
    }
  }

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

module.exports = {
  execRebaseMerge,
};
