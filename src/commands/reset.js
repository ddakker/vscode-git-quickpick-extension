'use strict';

// 리셋 명령 — soft/hard reset, 특정 커밋으로 reset.

const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');

async function execReset(item, mode) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const hash = item.commitHash;

  if (mode === '--hard') {
    const confirm = await vscode.window.showWarningMessage(
      t('confirmHardReset', hash.substring(0, 8)),
      { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  try {
    await execGit(['reset', mode, hash], cwd);
    vscode.window.showInformationMessage(t('resetSuccess', hash.substring(0, 8)));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function resetToHere(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const hash = item.commitHash;
  const modeItems = [
    { label: `$(history) ${t('resetSoft')}`, value: '--soft' },
    { label: `$(warning) ${t('resetHard')}`, value: '--hard' },
  ];
  const modeChoice = await vscode.window.showQuickPick(modeItems, {
    placeHolder: t('selectResetMode'),
  });
  if (!modeChoice) return;

  if (modeChoice.value === '--hard') {
    const confirm = await vscode.window.showWarningMessage(
      t('confirmHardReset', hash.substring(0, 8)),
      { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  try {
    await execGit(['reset', modeChoice.value, hash], cwd);
    vscode.window.showInformationMessage(t('resetSuccess', hash.substring(0, 8)));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

module.exports = {
  execReset, resetToHere,
};
