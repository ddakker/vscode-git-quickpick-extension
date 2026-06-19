'use strict';

// 스태시 명령 — 생성/복구(pop·apply)/삭제.

const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { getChangedFiles } = require('../git/queries');
const { isConflict } = require('../../lib/git-helpers');

async function execCreateStash() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const changes = await getChangedFiles(cwd);
  if (changes.length === 0) {
    vscode.window.showInformationMessage(t('noChangesToStash'));
    return;
  }

  const message = await vscode.window.showInputBox({
    prompt: t('enterStashMessage'),
    placeHolder: t('enterStashMessage'),
  });
  if (message === undefined) return; // 취소

  const args = ['stash', 'push', '--include-untracked'];
  if (message.trim()) args.push('-m', message.trim());

  try {
    await execGit(args, cwd);
    vscode.window.showInformationMessage(t('stashCreated'));
  } catch (err) {
    vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
  }
}

async function execStashRestore(item, keep) {
  const cwd = await validateGitWorkspace();
  if (!cwd || !item || !item.stashRef) return;

  const sub = keep ? 'apply' : 'pop';
  try {
    await execGit(['stash', sub, item.stashRef], cwd);
    vscode.window.showInformationMessage(keep ? t('stashApplied') : t('stashPopped'));
  } catch (err) {
    const msg = (err.stderr || err.message || String(err)).trim();
    // 충돌 시 git 은 스태시를 보존한다 — 안내만 한다.
    if (isConflict(msg)) {
      vscode.window.showWarningMessage(t('stashPopConflict'));
    } else {
      vscode.window.showErrorMessage(t('failed', msg));
    }
  }
}

async function execStashDrop(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd || !item || !item.stashRef) return;

  const confirm = await vscode.window.showWarningMessage(
    t('confirmDropStash', item.stashRef),
    { modal: true, detail: t('dropStashDetail') },
    t('delete')
  );
  if (confirm !== t('delete')) return;

  try {
    await execGit(['stash', 'drop', item.stashRef], cwd);
    vscode.window.showInformationMessage(t('stashDropped'));
  } catch (err) {
    vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
  }
}

module.exports = {
  execCreateStash, execStashRestore, execStashDrop,
};
