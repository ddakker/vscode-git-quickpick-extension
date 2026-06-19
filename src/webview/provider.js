'use strict';

// ─────────────────────────────────────────────────────────────────────
// 히스토리/브랜치 webview 프로바이더
//
//  - renderShell 로 골격, render() 에서 buildState → renderLists → postMessage.
//  - 메시지 라우터: ready/toggleSection/toggleBranch/command/op.
//  - fakeItem 빌더: 웹뷰 행 클릭을 기존 명령 핸들러로 전달(전략 A, M0 계약).
//  - unfetched 는 buildState 가 매번 재계산(source of truth) — fakeItem 변이는 버려도 안전.
// ─────────────────────────────────────────────────────────────────────

const vscode = require('vscode');
const { getWorkspaceCwd } = require('../workspace');
const { buildState } = require('./build-state');
const { renderShell, renderLists } = require('../../lib/webview-html');
const { t } = require('../i18n');

function nonceStr() {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
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
    tbPush: t('push'), tbPull: t('pull'), tbForcePull: t('forcePull'),
    tbStash: t('sectionStash'), tbCleanup: t('wvCleanup'), tbSettings: t('wvSettings'),
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
  constructor() {
    this._view = null;
    this._expanded = { history: true }; // 최초 히스토리만 펼침
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    const nonce = nonceStr();
    webviewView.webview.html = renderShell({
      nonce,
      cspSource: webviewView.webview.cspSource,
      labels: buildLabels(),
      menu: buildMenu(),
    });
    webviewView.webview.onDidReceiveMessage(msg => this._onMessage(msg));
    webviewView.onDidChangeVisibility(() => { if (webviewView.visible) this.refresh(); });
  }

  async _onMessage(msg) {
    if (msg.type === 'ready') { await this.refresh(); return; }
    if (msg.type === 'toggleSection') {
      this._expanded[msg.section] = !this._expanded[msg.section];
      await this.refresh();
      return;
    }
    if (msg.type === 'toggleBranch') {
      this._expanded[msg.branchName] = !this._expanded[msg.branchName];
      await this.refresh();
      return;
    }
    if (msg.type === 'op') {
      const cmd = msg.op === 'continue' ? 'gitReflow.continueOperation' : 'gitReflow.abortOperation';
      await vscode.commands.executeCommand(cmd);
      return;
    }
    if (msg.type === 'command') {
      await this._runCommand(msg.command, msg.arg);
      return;
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
      // 원격 브랜치 삭제는 별도 명령으로 분기
      if (command === 'gitReflow.execDeleteBranch' && arg.ctx === 'remoteBranch') {
        cmd = 'gitReflow.execDeleteRemoteBranch';
      }
    }
    await vscode.commands.executeCommand(cmd, item);
  }

  async refresh() {
    if (!this._view) return;
    const cwd = getWorkspaceCwd();
    if (!cwd) {
      this._view.webview.postMessage({ type: 'render', listsHtml: '' });
      return;
    }
    try {
      const state = await buildState(cwd, this._expanded);
      this._view.webview.postMessage({
        type: 'render',
        listsHtml: renderLists(state, buildLabels()),
      });
    } catch (err) {
      this._view.webview.postMessage({
        type: 'render',
        listsHtml: `<div class="empty">${String(err && err.message || err)}</div>`,
      });
    }
  }
}

module.exports = { HistoryViewProvider, buildLabels, buildMenu };
