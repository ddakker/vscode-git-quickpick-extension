'use strict';

// 변경 파일 명령 — stage/force-add/rollback/delete/gitignore.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { t, isKo } = require('../i18n');
const { execGit } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');

async function execStageFile(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;
  await execGit(['add', '--', item.filePath], cwd);
}

async function execForceAdd(uri, uris) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const targets = (uris && uris.length ? uris : (uri ? [uri] : []))
    .filter((u) => u && u.fsPath);
  if (targets.length === 0) return;

  const relPaths = targets.map((u) => path.relative(cwd, u.fsPath));
  const names = relPaths.map((p) => path.basename(p)).join(', ');

  try {
    await execGit(['add', '--force', '--', ...relPaths], cwd);
    vscode.window.showInformationMessage(
      isKo ? `강제 추가 완료: ${names}` : `Force added: ${names}`
    );
  } catch (err) {
    vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
  }
}

async function execRollbackFile(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const fileName = path.basename(item.filePath);
  const confirm = await vscode.window.showWarningMessage(
    isKo ? `${fileName} 변경을 되돌립니까?` : `Discard changes in ${fileName}?`,
    { modal: true }, t('yes')
  );
  if (confirm !== t('yes')) return;
  await execGit(['checkout', 'HEAD', '--', item.filePath], cwd);
}

async function execDeleteFile(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const fileName = path.basename(item.filePath);
  const confirm = await vscode.window.showWarningMessage(
    isKo ? `${fileName} 파일을 삭제합니까?` : `Delete ${fileName}?`,
    { modal: true }, t('yes')
  );
  if (confirm !== t('yes')) return;

  const fullPath = path.join(cwd, item.filePath);
  try {
    fs.unlinkSync(fullPath);
  } catch {
    await execGit(['rm', '-f', '--', item.filePath], cwd);
  }
}

async function execAddToGitignore(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  // gitignore는 슬래시 경로를 쓴다
  const entry = item.filePath.replace(/\\/g, '/');
  const gitignorePath = path.join(cwd, '.gitignore');

  let content = '';
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    content = '';
  }

  // 파일 끝 빈줄 제거 (재조합 시 재추가)
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const trimmedLines = lines.map(l => l.trim());
  if (trimmedLines.includes(entry) || trimmedLines.includes(item.filePath)) {
    vscode.window.showInformationMessage(t('gitignoreAlready', item.filePath));
    return;
  }

  // 동일 파일명에 ! 접두사가 있으면 제거
  const filtered = lines.filter(l => {
    const trimmed = l.trim();
    return trimmed !== `!${entry}` && trimmed !== `!${item.filePath}`;
  });

  // 시작 문자가 같은 줄 근처(마지막 위치 바로 다음)에 삽입
  const firstChar = entry[0];
  let insertAfterIdx = -1;
  for (let i = 0; i < filtered.length; i++) {
    const trimmed = filtered[i].trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed[0] === firstChar) {
      insertAfterIdx = i;
    }
  }

  if (insertAfterIdx >= 0) {
    filtered.splice(insertAfterIdx + 1, 0, entry);
  } else {
    filtered.push(entry);
  }

  fs.writeFileSync(gitignorePath, filtered.join('\n') + '\n');
  vscode.window.showInformationMessage(t('gitignoreAdded', item.filePath));
}

module.exports = {
  execStageFile, execForceAdd, execRollbackFile, execDeleteFile, execAddToGitignore,
};
