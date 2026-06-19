'use strict';

// 진행 중 작업 명령 — rebase/merge/cherry-pick abort·continue.

const vscode = require('vscode');
const { t, isKo } = require('../i18n');
const { execGit } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { hasInProgressOperation } = require('../git/queries');
const { getConflictedFiles } = require('../features/conflict');
const { handleGitError } = require('./error');
const { isConflict } = require('../../lib/git-helpers');

async function abortOperation() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (!inProgress) return;

  const abortCmd = inProgress === 'rebase' ? ['rebase', '--abort']
    : inProgress === 'cherry-pick' ? ['cherry-pick', '--abort']
    : ['merge', '--abort'];
  const label = inProgress === 'rebase' ? t('abortRebase')
    : inProgress === 'cherry-pick' ? t('abortCherryPick')
    : t('abortMerge');

  const confirm = await vscode.window.showWarningMessage(
    label + '?', { modal: true }, t('yes')
  );
  if (confirm !== t('yes')) return;

  try {
    await execGit(abortCmd, cwd);
    vscode.window.showInformationMessage(
      isKo ? '작업이 취소되었습니다.' : 'Operation aborted.'
    );
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function continueOperation() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (!inProgress) {
    vscode.window.showInformationMessage(
      isKo ? '진행 중인 작업이 없습니다.' : 'No operation in progress.'
    );
    return;
  }

  // 충돌 파일이 남아있는지 확인
  const conflictFiles = await getConflictedFiles(cwd);
  if (conflictFiles.length > 0) {
    vscode.window.showWarningMessage(
      isKo ? `아직 해결되지 않은 충돌 파일이 ${conflictFiles.length}개 있습니다.`
        : `${conflictFiles.length} conflicted file(s) remaining.`
    );
    return;
  }

  try {
    // 변경사항 stage
    await execGit(['add', '.'], cwd);

    const continueCmd = inProgress === 'rebase' ? ['rebase', '--continue']
      : inProgress === 'cherry-pick' ? ['cherry-pick', '--continue']
      : ['commit', '--no-edit'];
    await execGit(continueCmd, cwd, { env: { ...process.env, GIT_EDITOR: 'true' } });
    vscode.window.showInformationMessage(
      isKo ? '작업이 완료되었습니다.' : 'Operation completed.'
    );
  } catch (err) {
    const msg = err.stderr || err.stdout || err.message || String(err);
    if (isConflict(msg)) {
      await handleGitError(err, inProgress, cwd);
    } else {
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
  }
}

module.exports = {
  abortOperation, continueOperation,
};
