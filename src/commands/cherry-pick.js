'use strict';

// 체리픽 명령 — 선택 커밋을 현재 브랜치에 적용.

const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { hasInProgressOperation } = require('../git/queries');
const { handleGitError } = require('./error');

async function execCherryPickCommit(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress) {
    const msgKey = inProgress === 'rebase' ? 'inProgressRebase'
      : inProgress === 'cherry-pick' ? 'inProgressCherryPick'
      : 'inProgressMerge';
    vscode.window.showWarningMessage(t(msgKey));
    return;
  }

  const hash = item.commitHash;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git cherry-pick ${hash.substring(0, 8)}`) },
      () => execGit(['cherry-pick', hash], cwd)
    );
    vscode.window.showInformationMessage(t('cherryPickSuccess', hash.substring(0, 8)));
  } catch (err) {
    await handleGitError(err, 'cherry-pick', cwd);
  }
}

module.exports = {
  execCherryPickCommit,
};
