'use strict';

// 워크스페이스/저장소 유효성 — cwd 결정 + git 저장소 검증.

const vscode = require('vscode');
const { t } = require('./i18n');
const { isGitRepo } = require('./git/queries');

function getWorkspaceCwd() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) return folder.uri.fsPath;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

async function validateGitWorkspace() {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    vscode.window.showErrorMessage(t('noWorkspace'));
    return null;
  }
  if (!await isGitRepo(cwd)) {
    vscode.window.showErrorMessage(t('notGitRepo'));
    return null;
  }
  return cwd;
}

module.exports = { getWorkspaceCwd, validateGitWorkspace };
