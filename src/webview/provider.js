'use strict';

// ─────────────────────────────────────────────────────────────────────
// 히스토리/브랜치 + 커밋 입력 webview 프로바이더 (통합)
//
//  - renderShell 로 골격(툴바 + 입력영역 + 리스트), render() 에서 buildState → renderLists.
//  - 리스트만 전체 재렌더(#lists), 입력영역은 restore/clear postMessage 로 분리(A1).
//  - 입력 위치(top/bottom/hidden)는 messageInputPosition 설정 → body class (요구 2).
//  - 커밋/squash/amend 흐름(waitForCommit/onDidCommit)을 흡수 — 기존 CommitInputViewProvider 대체.
//  - 행 클릭 → fakeItem → 기존 명령(전략 A). unfetched 는 buildState 가 재계산(M0/A2).
// ─────────────────────────────────────────────────────────────────────

const vscode = require('vscode');
const { getWorkspaceCwd } = require('../workspace');
const { buildState } = require('./build-state');
const { renderShell, renderLists } = require('../../lib/webview-html');
const { t, isKo } = require('../i18n');

function nonceStr() {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function readInputPosition() {
  const pos = vscode.workspace.getConfiguration('gitReflow').get('messageInputPosition', 'top');
  return ['top', 'bottom', 'hidden'].includes(pos) ? pos : 'top';
}

function buildLabels() {
  return {
    loading: t('fetchingRemotes'),
    noCommits: t('noCommits'),
    noBranches: t('noBranches'),
    current: t('current'),
    sectionHistory: t('sectionHistory'),
    sectionLocalBranch: t('sectionLocalBranch'),
    sectionRemoteBranch: t('sectionRemoteBranch'),
    continue: t('continueRebase'),
    abort: t('abortRebase'),
    inProgress: { rebase: t('inProgressRebase'), merge: t('inProgressMerge'), 'cherry-pick': t('inProgressCherryPick') },
    tbRefresh: t('wvRefresh'), tbNewBranch: t('enterBranchName'),
    tbPush: t('push'), tbForcePush: t('pushForce'), tbPull: t('pull'), tbForcePull: t('forcePull'),
    tbStash: t('sectionStash'), tbCleanup: t('wvCleanup'), tbSettings: t('wvSettings'),
    inputPlaceholder: t('inputPlaceholder'), inputCommit: t('inputCommit'), inputRecent: t('inputRecent'),
  };
}

// 커밋/브랜치 우클릭 메뉴 정의 (command + 라벨)
function buildMenu() {
  return {
    commit: [
      { command: 'gitReflow.copyHash', label: t('copyHash') },
      { command: 'gitReflow.copyMessage', label: t('copyMessage') },
      { command: 'gitReflow.viewDiff', label: t('viewDiff') },
      { command: 'gitReflow.execCherryPick', label: t('cherryPickAction') },
      { command: 'gitReflow.resetToHere', label: t('resetToHere') },
      { command: 'gitReflow.execAmendMessage', label: t('menuAmend') },
      { command: 'gitReflow.execInteractiveRebase', label: t('menuSquash') },
    ],
    branch: [
      { command: 'gitReflow.execSwitch', label: t('menuSwitch') },
      { command: 'gitReflow.execBranchPull', label: t('pull') },
      { command: 'gitReflow.execForceBranchPull', label: t('forcePull') },
      { command: 'gitReflow.execRebase', label: t('menuRebase') },
      { command: 'gitReflow.execMerge', label: t('menuMerge') },
      { command: 'gitReflow.execDeleteBranch', label: t('delete') },
    ],
  };
}

class HistoryViewProvider {
  constructor(globalState) {
    this._view = null;
    this._globalState = globalState;
    this._expanded = { history: true }; // 최초 히스토리만 펼침
    // 커밋 입력 상태 (CommitInputViewProvider 에서 흡수)
    this._message = '';
    this._pendingResolve = null;       // squash/amend 등 외부 대기
    this._pendingButtonLabel = null;
    this._pendingCancelLabel = null;
    this._branchDescription = '';
    this._onDidCommit = new vscode.EventEmitter();
    this.onDidCommit = this._onDidCommit.event;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.description = this._branchDescription;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderShell({
      nonce: nonceStr(),
      cspSource: webviewView.webview.cspSource,
      labels: buildLabels(),
      menu: buildMenu(),
      inputPosition: readInputPosition(),
    });
    webviewView.webview.onDidReceiveMessage(msg => this._onMessage(msg));
    webviewView.onDidChangeVisibility(() => { if (webviewView.visible) this.refresh(); });

    // 패널 재오픈 시 입력 내용/버튼 상태 복원
    if (this._message || this._pendingButtonLabel) {
      setTimeout(() => {
        if (this._message) webviewView.webview.postMessage({ type: 'restore', value: this._message });
        if (this._pendingButtonLabel) webviewView.webview.postMessage({ type: 'setButtonLabel', value: this._pendingButtonLabel });
        if (this._pendingCancelLabel) webviewView.webview.postMessage({ type: 'showCancel', value: this._pendingCancelLabel });
      }, 100);
    }
  }

  // ─── 메시지 라우터 ───────────────────────────────────────────────
  async _onMessage(msg) {
    switch (msg.type) {
      case 'ready': return this.refresh();
      case 'toggleSection':
        this._expanded[msg.section] = !this._expanded[msg.section];
        return this.refresh();
      case 'toggleBranch':
        this._expanded[msg.branchName] = !this._expanded[msg.branchName];
        return this.refresh();
      case 'op': {
        const cmd = msg.op === 'continue' ? 'gitReflow.continueOperation' : 'gitReflow.abortOperation';
        return void vscode.commands.executeCommand(cmd);
      }
      case 'command': return this._runCommand(msg.command, msg.arg);
      // ─ 입력 영역 ─
      case 'input': this._message = msg.value; return;
      case 'commit':
        this._message = msg.value;
        if (this._pendingResolve) {
          const resolve = this._pendingResolve;
          this._pendingResolve = null;
          resolve(msg.value);
        } else {
          this._onDidCommit.fire(msg.value);
        }
        return;
      case 'cancel': return this.cancelWait();
      case 'showHistory': return this._showHistoryQuickPick();
      default: return;
    }
  }

  // 웹뷰 행 → fakeItem 으로 기존 명령 호출 (전략 A)
  async _runCommand(command, arg) {
    let cmd = command;
    let item;
    if (arg && arg.kind === 'commit') {
      item = { commitHash: arg.hash, contextValue: arg.ctx };
    } else if (arg && arg.kind === 'branch') {
      item = { branchName: arg.branch, contextValue: arg.ctx, unfetched: !!arg.unfetched };
      if (command === 'gitReflow.execDeleteBranch' && arg.ctx === 'remoteBranch') {
        cmd = 'gitReflow.execDeleteRemoteBranch';
      }
    }
    await vscode.commands.executeCommand(cmd, item);
  }

  // ─── 리스트 렌더 (입력영역과 분리) ───────────────────────────────
  async refresh() {
    if (!this._view) return;
    const cwd = getWorkspaceCwd();
    if (!cwd) {
      this._view.webview.postMessage({ type: 'render', listsHtml: '' });
      return;
    }
    try {
      const state = await buildState(cwd, this._expanded);
      this._view.webview.postMessage({ type: 'render', listsHtml: renderLists(state, buildLabels()) });
    } catch (err) {
      this._view.webview.postMessage({ type: 'render', listsHtml: `<div class="empty">${String(err && err.message || err)}</div>` });
    }
  }

  updateInputPosition() {
    if (this._view) this._view.webview.postMessage({ type: 'inputPosition', pos: readInputPosition() });
  }

  // ─── 커밋 입력 (CommitInputViewProvider 흡수) ────────────────────
  setBranchDescription(text) {
    this._branchDescription = text || '';
    if (this._view) this._view.description = this._branchDescription;
  }

  getMessage() { return this._message; }

  setMessage(msg) {
    this._message = msg;
    if (this._view) this._view.webview.postMessage({ type: 'restore', value: msg });
  }

  clearMessage() {
    this._message = '';
    if (this._view) this._view.webview.postMessage({ type: 'clear' });
  }

  getHistory() { return this._globalState.get('commitHistory', []); }

  addHistory(msg) {
    let history = this.getHistory().filter(h => h !== msg);
    history.unshift(msg);
    if (history.length > 5) history = history.slice(0, 5);
    this._globalState.update('commitHistory', history);
  }

  // 메시지를 세팅하고 커밋 버튼을 누를 때까지 대기 (squash/amend 등 외부 흐름).
  waitForCommit(defaultMsg, buttonLabel) {
    if (this._pendingResolve) { this._pendingResolve(undefined); this._pendingResolve = null; }
    this.setMessage(defaultMsg);
    this._pendingButtonLabel = buttonLabel || null;
    this._pendingCancelLabel = t('cancel');
    if (this._view) {
      if (buttonLabel) this._view.webview.postMessage({ type: 'setButtonLabel', value: buttonLabel });
      this._view.webview.postMessage({ type: 'showCancel', value: this._pendingCancelLabel });
      this._view.webview.postMessage({ type: 'focusInput' });
    }
    vscode.commands.executeCommand('gitQuickPickHistory.focus');
    const restoreLabel = () => {
      this._pendingButtonLabel = null;
      this._pendingCancelLabel = null;
      if (this._view) {
        this._view.webview.postMessage({ type: 'setButtonLabel', value: t('inputCommitDefault') });
        this._view.webview.postMessage({ type: 'hideCancel' });
      }
      this.clearMessage();
    };
    return new Promise((resolve) => {
      this._pendingResolve = (value) => { restoreLabel(); resolve(value); };
    });
  }

  cancelWait() {
    if (this._pendingResolve) { this._pendingResolve(undefined); this._pendingResolve = null; }
  }

  async _showHistoryQuickPick() {
    const history = this.getHistory();
    if (history.length === 0) {
      vscode.window.showInformationMessage(t('noCommitHistory'));
      return;
    }
    const picked = await vscode.window.showQuickPick(history.map(m => ({ label: m })), {
      placeHolder: t('selectRecentMsg'),
    });
    if (picked) this.setMessage(picked.label);
  }
}

module.exports = { HistoryViewProvider, buildLabels, buildMenu };
