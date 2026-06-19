'use strict';

// git 에러 처리 — 충돌이면 해결/abort/터미널 안내, 그 외는 에러 메시지 표시.

const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit } = require('../git/exec');
const { isConflict } = require('../../lib/git-helpers');
const { getConflictedFiles, openMergeEditors } = require('../features/conflict');
const runtime = require('../runtime');

async function handleGitError(err, action, cwd) {
  const msg = err.stderr || err.stdout || err.message || String(err);

  if (isConflict(msg)) {
    const abortLabel = action === 'rebase' ? t('abortRebase')
      : action === 'cherry-pick' ? t('abortCherryPick')
      : t('abortMerge');
    const abortCmd = action === 'rebase' ? ['rebase', '--abort']
      : action === 'cherry-pick' ? ['cherry-pick', '--abort']
      : ['merge', '--abort'];

    const conflictFiles = await getConflictedFiles(cwd);

    // 충돌 감지 즉시 트리 갱신 (abort 버튼 표시)
    const _refresh = runtime.getFullRefreshFn();
    if (_refresh) await _refresh();

    const choice = await vscode.window.showWarningMessage(
      t('conflictDetected'),
      { modal: true },
      t('resolveInEditor'),
      abortLabel,
      t('openTerminal')
    );

    if (choice === t('resolveInEditor')) {
      if (conflictFiles.length > 0) {
        vscode.window.showInformationMessage(
          t('openingMergeEditor', conflictFiles.length)
        );
        await openMergeEditors(cwd, conflictFiles);
      }
      if (action === 'rebase') {
        vscode.window.showInformationMessage(t('rebaseContinueHint'));
      } else if (action === 'cherry-pick') {
        vscode.window.showInformationMessage(t('cherryPickContinueHint'));
      }
    } else if (choice === abortLabel) {
      await execGit(abortCmd, cwd);
    } else if (choice === t('openTerminal')) {
      const terminal = vscode.window.createTerminal({ cwd });
      terminal.show();
    }
  } else {
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

module.exports = { handleGitError };
