'use strict';

// 인라인 git blame — 커서가 위치한 줄의 마지막 커밋 정보를 에디터 끝에 표시.

const vscode = require('vscode');
const path = require('path');
const { isKo } = require('../i18n');
const { execGitSilent } = require('../git/exec');
const { formatRelativeText } = require('../../lib/relative-date');

const blameDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
    fontStyle: 'normal',
    margin: '0 0 0 3em',
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});

let blameTimeout = null;
let lastBlameKey = '';

async function updateInlineBlame(editor) {
  if (!editor || editor.document.uri.scheme !== 'file') {
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) return;

  const cwd = folder.uri.fsPath;
  const line = editor.selection.active.line + 1; // git blame은 1-based

  const blameKey = `${filePath}:${line}`;
  if (blameKey === lastBlameKey) return;
  lastBlameKey = blameKey;

  try {
    const relativePath = path.relative(cwd, filePath);
    const { stdout } = await execGitSilent(
      ['blame', '-L', `${line},${line}`, '--porcelain', '--', relativePath],
      cwd,
      { timeout: 5000 }
    );

    if (!stdout.trim()) {
      editor.setDecorations(blameDecorationType, []);
      return;
    }

    const lines = stdout.split('\n');
    // porcelain 첫 줄: <hash> <orig-line> <final-line> <num-lines>
    const hash = lines[0].split(' ')[0];

    // 커밋되지 않은 변경
    if (/^0+$/.test(hash)) {
      editor.setDecorations(blameDecorationType, []);
      return;
    }

    let author = '';
    let authorTime = '';
    let summary = '';
    for (const l of lines) {
      if (l.startsWith('author ')) author = l.substring(7);
      else if (l.startsWith('author-time ')) authorTime = l.substring(12);
      else if (l.startsWith('summary ')) summary = l.substring(8);
    }

    const dateStr = authorTime
      ? formatRelativeDate(parseInt(authorTime, 10))
      : '';
    const shortHash = hash.substring(0, 8);
    const text = `    ${author}, ${dateStr} • ${summary} (${shortHash})`;

    const lineIdx = line - 1;
    const lineText = editor.document.lineAt(lineIdx);
    const range = new vscode.Range(lineIdx, lineText.text.length, lineIdx, lineText.text.length);

    editor.setDecorations(blameDecorationType, [{
      range,
      renderOptions: {
        after: { contentText: text },
      },
    }]);
  } catch {
    editor.setDecorations(blameDecorationType, []);
  }
}

function formatRelativeDate(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  return formatRelativeText(now - timestamp, isKo);
}

function scheduleBlameUpdate(editor) {
  if (blameTimeout) clearTimeout(blameTimeout);
  blameTimeout = setTimeout(() => updateInlineBlame(editor), 150);
}

function resetBlameKey() { lastBlameKey = ''; }

function disposeBlame() {
  if (blameTimeout) clearTimeout(blameTimeout);
  blameDecorationType.dispose();
}

module.exports = {
  updateInlineBlame,
  scheduleBlameUpdate,
  formatRelativeDate,
  resetBlameKey,
  disposeBlame,
};
