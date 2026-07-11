'use strict';

// git 에러 처리 — 충돌이면 해결/abort/터미널 안내, 그 외는 에러 메시지 표시.

const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit } = require('../git/exec');
const { isConflict, formatGitError, isHookError } = require('../../lib/git-helpers');
const { getConflictedFiles, openMergeEditors } = require('../features/conflict');
const runtime = require('../runtime');

// 상태바 에러 표시 자동 숨김 타이머 (연속 에러 시 이전 타이머 갱신)
let _statusTimer = null;

// 하단 상태바에 빨간 에러 배지를 잠깐 띄운다. 클릭하면 출력 채널이 열린다(명령 연결됨).
function flashErrorStatus(text) {
  const item = runtime.getErrorStatusItem();
  if (!item) return;
  item.text = text;
  item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  item.show();
  if (_statusTimer) clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => { item.hide(); _statusTimer = null; }, 8000);
}

// git 에러를 사용자에게 표시 — stderr+stdout 을 합친 상세 메시지 + "출력 채널 열기" 버튼.
// 훅(pre-commit 등) 실패 상세는 stdout·여러 줄로 나와 알림창에서 잘리므로
// 버튼으로 출력 패널에서 전체 로그를 볼 수 있게 하고, 하단 상태바에도 빨간 배지를 띄운다.
async function showGitError(err) {
  const raw = formatGitError(err);
  const hook = isHookError(raw);
  const msg = hook ? `${t('hookFailedPrefix')}\n${raw}` : raw;

  flashErrorStatus(hook ? t('statusHookFailed') : t('statusGitFailed'));

  const choice = await vscode.window.showErrorMessage(
    t('failed', msg), t('openOutput')
  );
  if (choice === t('openOutput')) {
    const ch = runtime.getOutputChannel();
    if (ch) ch.show(true);
  }
}

async function handleGitError(err, action, cwd, note) {
  const msg = err.stderr || err.stdout || err.message || String(err);
  const ch = runtime.getOutputChannel();

  if (isConflict(msg)) {
    const abortLabel = action === 'rebase' ? t('abortRebase')
      : action === 'cherry-pick' ? t('abortCherryPick')
      : t('abortMerge');
    const abortCmd = action === 'rebase' ? ['rebase', '--abort']
      : action === 'cherry-pick' ? ['cherry-pick', '--abort']
      : ['merge', '--abort'];

    const conflictFiles = await getConflictedFiles(cwd);
    if (ch) ch.appendLine(`[handleGitError] action=${action} conflictFiles(${conflictFiles.length}): ${conflictFiles.join(', ')}${note ? ' note=' + note : ''}`);

    // 충돌 감지 즉시 트리 갱신 (abort 버튼 표시)
    const _refresh = runtime.getFullRefreshFn();
    if (_refresh) await _refresh();

    const msgOpts = note ? { modal: true, detail: note } : { modal: true };
    const choice = await vscode.window.showWarningMessage(
      t('conflictDetected'),
      msgOpts,
      t('resolveInEditor'),
      abortLabel,
      t('openTerminal')
    );
    if (ch) ch.appendLine(`[handleGitError] user choice: ${choice || '(dismissed)'}`);

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
      if (ch) ch.appendLine(`[handleGitError] aborting ${action}`);
      await execGit(abortCmd, cwd);
    } else if (choice === t('openTerminal')) {
      const terminal = vscode.window.createTerminal({ cwd });
      terminal.show();
    }
  } else {
    if (ch) ch.appendLine(`[handleGitError] non-conflict error: ${msg.trim()}`);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

module.exports = { handleGitError, showGitError };
