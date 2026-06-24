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
const { fileOpenCommand } = require('../git/queries');
const { openWorkingFile } = require('../features/conflict');
const { t, isKo } = require('../i18n');

function nonceStr() {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function readInputPosition() {
  const pos = vscode.workspace.getConfiguration('gitReflow').get('messageInputPosition', 'bottom');
  return ['top', 'bottom'].includes(pos) ? pos : 'bottom';
}

function buildLabels() {
  return {
    loading: t('fetchingRemotes'),
    noCommits: t('noCommits'),
    noBranches: t('noBranches'),
    noDiffFiles: t('noDiffFiles'),
    current: t('current'),
    sectionHistory: t('sectionHistory'),
    sectionLocalBranch: t('sectionLocalBranch'),
    sectionRemoteBranch: t('sectionRemoteBranch'),
    continueLabels: {
      rebase: t('continueRebase'),
      merge: t('continueMerge'),
      'cherry-pick': t('continueCherryPick'),
    },
    abortLabels: {
      rebase: t('abortRebase'),
      merge: t('abortMerge'),
      'cherry-pick': t('abortCherryPick'),
    },
    inProgress: { rebase: t('inProgressRebase'), merge: t('inProgressMerge'), 'cherry-pick': t('inProgressCherryPick') },
    inputPlaceholder: t('inputPlaceholder'), inputCommit: t('inputCommit'), inputRecent: t('inputRecent'),
    // 변경/스태시 섹션
    sectionCommit: t('sectionCommit'), sectionStash: t('sectionStash'),
    selectAll: t('selectAll'), toggleFileView: t('toggleFileView'),
    noChanges: t('noChanges'), noStash: t('noStash'),
    loadMore: t('loadMore'),
    // 변경 파일 hover 인라인 액션 라벨(툴팁)
    fileActions: {
      jumpToSource: t('mJumpToSource'), stageFile: t('mStageFile'),
      rollbackFile: t('mRollbackFile'), deleteFile: t('mDeleteFile'),
      openConflictMergeEditor: t('mOpenConflictMerge'), openConflictInEditor: t('mOpenConflictEditor'),
      acceptMerge: t('mAcceptMerge'),
    },
    acceptMergeHint: t('acceptMergeHint'),
  };
}

// 우클릭 메뉴 — 항목 종류(contextValue)별로 정의 (원본 트리 메뉴와 동일 구성).
function buildMenu() {
  const copy = [
    { command: 'gitReflow.copyHash', label: t('mCopyHash') },
    { command: 'gitReflow.copyMessage', label: t('mCopyMessage') },
  ];
  const squash = { command: 'gitReflow.execInteractiveRebase', label: t('mSquash') };
  const reset = [
    { command: 'gitReflow.execSoftReset', label: t('mSoftReset') },
    { command: 'gitReflow.execHardReset', label: t('mHardReset') },
  ];
  const amend = { command: 'gitReflow.execAmendMessage', label: t('mAmend') };
  return {
    // 히스토리 커밋: 복사 / squash / soft·hard reset (최신 커밋은 amend 만 활성, 나머지 비활성)
    historyCommit: [...copy, squash, ...reset],
    historyCommitLatest: [...copy, amend, { ...squash, disabled: true }, ...reset.map(r => ({ ...r, disabled: true }))],
    // 브랜치 펼친 커밋: 복사 / 체리픽
    branchHistoryCommit: [...copy, { command: 'gitReflow.execCherryPick', label: t('mCherryPick') }],
    // 로컬 브랜치: 전환/pull/force-pull/rebase/merge/삭제
    localBranch: [
      { command: 'gitReflow.execSwitch', label: t('mSwitch') },
      { command: 'gitReflow.execBranchPull', label: t('mBranchPull') },
      { command: 'gitReflow.execForceBranchPull', label: t('mForceBranchPull') },
      { command: 'gitReflow.execRebase', label: t('mRebase') },
      { command: 'gitReflow.execMerge', label: t('mMerge') },
      { command: 'gitReflow.execDeleteBranch', label: t('mDeleteBranch') },
    ],
    // 현재 브랜치: pull/force-pull 만 (전환·삭제 불가)
    localBranchCurrent: [
      { command: 'gitReflow.execBranchPull', label: t('mBranchPull') },
      { command: 'gitReflow.execForceBranchPull', label: t('mForceBranchPull') },
    ],
    // 원격 브랜치: 전환/rebase/merge/원격삭제
    remoteBranch: [
      { command: 'gitReflow.execSwitch', label: t('mSwitch') },
      { command: 'gitReflow.execRebase', label: t('mRebase') },
      { command: 'gitReflow.execMerge', label: t('mMerge') },
      { command: 'gitReflow.execDeleteRemoteBranch', label: t('mDeleteRemoteBranch') },
    ],
    // 로컬 브랜치 섹션 헤더: 브랜치 생성 (master 의 localBranchSection 메뉴)
    localBranchSection: [
      { command: 'gitReflow.createBranch', label: t('mCreateBranch') },
    ],
    // 커밋 펼친 파일: 비교끼리(변경 비교=더블클릭 / 로컬과 비교) 묶고, 열기는 현재 파일
    commitFile: [
      { command: 'gitReflow.openCommitFileDiff', label: t('mFileDiff') },
      { command: 'gitReflow.openCommitFileVsLocal', label: t('mFileCompare') },
      { command: 'gitReflow.openCurrentFile', label: t('mFileOpen') },
    ],
    // 삭제된 파일: 열기 비활성화
    commitFileDeleted: [
      { command: 'gitReflow.openCommitFileDiff', label: t('mFileDiff') },
      { command: 'gitReflow.openCommitFileVsLocal', label: t('mFileCompare') },
      { command: 'gitReflow.openCurrentFile', label: t('mFileOpen'), disabled: true },
    ],
    // ─ 변경 사항 파일 (트리 view/item/context 와 동일 구성) ─
    fileUntracked: [
      { command: 'gitReflow.jumpToSource', label: t('mJumpToSource') },
      { command: 'gitReflow.stageFile', label: t('mStageFile') },
      { command: 'gitReflow.deleteFile', label: t('mDeleteFile') },
      { command: 'gitReflow.addToGitignore', label: t('mAddGitignore') },
      { command: 'gitReflow.copyPath', label: t('mCopyPath') },
      { command: 'gitReflow.copyRelativePath', label: t('mCopyRelPath') },
    ],
    fileModified: [
      { command: 'gitReflow.openChangedFile', label: t('mFileDiff') }, // 더블클릭과 동일(HEAD와 diff)
      { command: 'gitReflow.jumpToSource', label: t('mJumpToSource') },
      { command: 'gitReflow.rollbackFile', label: t('mRollbackFile') },
      { command: 'gitReflow.deleteFile', label: t('mDeleteFile') },
      { command: 'gitReflow.copyPath', label: t('mCopyPath') },
      { command: 'gitReflow.copyRelativePath', label: t('mCopyRelPath') },
    ],
    fileDeleted: [
      { command: 'gitReflow.openChangedFile', label: t('mFileDiff') }, // 더블클릭과 동일(삭제 diff)
      { command: 'gitReflow.rollbackFile', label: t('mRollbackFile') },
      { command: 'gitReflow.copyPath', label: t('mCopyPath') },
      { command: 'gitReflow.copyRelativePath', label: t('mCopyRelPath') },
    ],
    fileConflict: [
      { command: 'gitReflow.openConflictMergeEditor', label: t('mOpenConflictMerge') },
      { command: 'gitReflow.openConflictInEditor', label: t('mOpenConflictEditor') },
      { command: 'gitReflow.acceptMerge', label: t('mAcceptMerge') },
      { command: 'gitReflow.copyPath', label: t('mCopyPath') },
      { command: 'gitReflow.copyRelativePath', label: t('mCopyRelPath') },
    ],
    fileOther: [
      { command: 'gitReflow.jumpToSource', label: t('mJumpToSource') },
      { command: 'gitReflow.deleteFile', label: t('mDeleteFile') },
      { command: 'gitReflow.copyPath', label: t('mCopyPath') },
      { command: 'gitReflow.copyRelativePath', label: t('mCopyRelPath') },
    ],
    // ─ 스태시 ─
    stashSection: [
      { command: 'gitReflow.createStash', label: t('mCreateStash') },
    ],
    stashEntry: [
      { command: 'gitReflow.stashPop', label: t('mStashPop') },
      { command: 'gitReflow.stashApply', label: t('mStashApply') },
      { command: 'gitReflow.stashDrop', label: t('mStashDrop') },
    ],
    stashFile: [
      { command: 'gitReflow.jumpToSource', label: t('mJumpToSource') },
    ],
  };
}

class HistoryViewProvider {
  constructor(globalState) {
    this._view = null;
    this._globalState = globalState;
    this._expanded = { history: true, changes: true }; // 히스토리·변경 사항 펼침
    this._expandedCommits = new Set();  // 파일목록 펼친 커밋 해시
    this._expandedStashFiles = new Set(); // 파일목록 펼친 스태시 ref
    this._historyPage = 1;              // 히스토리 페이지 (더 불러오기)
    this._branchPages = {};             // { branchName: pageNum } 브랜치별 페이지
    this._cache = {};                   // buildState 데이터 캐시 (토글 시 git 조회 0회)
    // 변경 사항(체크박스 커밋 대상) — 옵션 ON 시 트리 대신 이 provider 가 보유
    this._checkedFiles = new Map();     // filePath -> bool
    this._fileViewMode = 'list';        // 'list' | 'tree'
    this._changes = [];                 // 마지막 변경 목록 (더블클릭 fileOpenCommand 조회용)
    this._externalHasChecked = false;   // 트리 모드 체크 상태 (extension.js 가 주입)
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
      case 'toggleCommit':
        if (this._expandedCommits.has(msg.hash)) this._expandedCommits.delete(msg.hash);
        else this._expandedCommits.add(msg.hash);
        return this.refresh();
      case 'toggleStashEntry':
        if (this._expandedStashFiles.has(msg.ref)) this._expandedStashFiles.delete(msg.ref);
        else this._expandedStashFiles.add(msg.ref);
        return this.refresh();
      case 'loadMore':
        if (msg.section === 'history') {
          this._historyPage += 1;
        } else if (msg.section === 'branch' && msg.branch) {
          this._branchPages[msg.branch] = (this._branchPages[msg.branch] || 1) + 1;
        }
        return this.refresh();
      // ─ 변경 사항 (체크박스/보기 모드) ─
      case 'toggleFile':
        this._checkedFiles.set(msg.path, !!msg.checked);
        this._updateChangesContext();
        this.updateInputVisibility(true); // 체크로 입력창이 나타나면 포커스 이동
        return;
      case 'selectAll':
        for (const key of this._checkedFiles.keys()) this._checkedFiles.set(key, !!msg.checked);
        this._updateChangesContext();
        this.updateInputVisibility(true);
        return;
      case 'toggleFileViewMode':
        return this.toggleFileView();
      case 'openChangedFile':
        return this._openChangedFile(msg.path);
      case 'openCommitFile': {
        const cwd = getWorkspaceCwd();
        if (cwd && msg.hash && msg.file) {
          vscode.commands.executeCommand('gitReflow.openCommitFileDiff', msg.hash, msg.file, cwd);
        }
        return;
      }
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
    // 변경 파일 "변경 비교" — 더블클릭과 동일하게 상태별 diff/열기 (sentinel 명령).
    if (command === 'gitReflow.openChangedFile' && arg && arg.kind === 'changedFile') {
      return this._openChangedFile(arg.path);
    }
    if (arg && arg.kind === 'commit') {
      item = { commitHash: arg.hash, contextValue: arg.ctx };
    } else if (arg && arg.kind === 'branch') {
      item = { branchName: arg.branch, contextValue: arg.ctx, unfetched: !!arg.unfetched };
      if (command === 'gitReflow.execDeleteBranch' && arg.ctx === 'remoteBranch') {
        cmd = 'gitReflow.execDeleteRemoteBranch';
      }
    } else if (arg && arg.kind === 'file') {
      // 커밋 파일 명령은 (hash, filePath, cwd) 위치 인자 / vsLocal 은 item 사용
      const cwd = getWorkspaceCwd();
      if (command === 'gitReflow.openCommitFileVsLocal') {
        return void vscode.commands.executeCommand(command, { commitHash: arg.hash, tooltip: arg.file });
      }
      if (command === 'gitReflow.openCurrentFile') {
        openWorkingFile(arg.file);
        return;
      }
      return void vscode.commands.executeCommand(command, arg.hash, arg.file, cwd);
    } else if (arg && arg.kind === 'changedFile') {
      // 변경 파일 명령은 item.filePath 를 사용 (스테이지/되돌리기/삭제/gitignore/경로복사/소스이동)
      item = { filePath: arg.path };
    } else if (arg && arg.kind === 'stash') {
      // 스태시 항목/파일 명령은 item.stashRef / item.filePath 사용
      item = { stashRef: arg.ref, filePath: arg.path };
    }
    await vscode.commands.executeCommand(cmd, item);
  }

  // ─── 리스트 렌더 (입력영역과 분리) ───────────────────────────────
  // 토글 등 데이터 불변 갱신: 캐시 재사용 → git 조회 0회.
  async refresh() {
    if (!this._view) return;
    const cwd = getWorkspaceCwd();
    if (!cwd) {
      this._cache = {};
      this._changes = [];
      this._view.webview.postMessage({ type: 'render', listsHtml: '' });
      return;
    }
    try {
      const expanded = {
        ...this._expanded,
        __commits: [...this._expandedCommits],
        __stashFiles: [...this._expandedStashFiles],
        __historyPage: this._historyPage,
        __branchPages: { ...this._branchPages },
      };
      const state = await buildState(cwd, expanded, undefined, this._cache);
      this._changes = state.changes || [];
      this._reconcileChecked(this._changes);
      state.checkedFiles = new Set(this.getCheckedFiles());
      state.fileViewMode = this._fileViewMode;
      this._updateChangesContext();
      this._view.webview.postMessage({ type: 'render', listsHtml: renderLists(state, buildLabels()) });
      this.updateInputVisibility();
    } catch (err) {
      this._view.webview.postMessage({ type: 'render', listsHtml: `<div class="empty">${String(err && err.message || err)}</div>` });
    }
  }

  // 입력창/커밋 버튼 표시 여부 갱신 (showInputWhenChecked 옵션).
  //   옵션 OFF → 항상 표시. 옵션 ON → 체크된 파일이 있을 때만(squash/amend 흐름은 예외).
  //   focusInput: 체크로 입력창이 나타날 때 입력창에 포커스(숨김→표시 전환 시에만 적용).
  updateInputVisibility(focusInput = false) {
    if (!this._view) return;
    const onlyWhenChecked =
      vscode.workspace.getConfiguration('gitReflow').get('showInputWhenChecked', true) !== false;
    const hasChecked = this._pendingResolve != null
      || this.getCheckedFiles().length > 0
      || this._externalHasChecked;
    this._view.webview.postMessage({
      type: 'inputVisible', visible: !onlyWhenChecked || hasChecked, focus: focusInput,
    });
  }

  // 트리 모드(옵션 OFF)에서 트리 체크 상태를 주입받아 입력창 표시를 갱신.
  setExternalCheckedState(hasChecked) {
    this._externalHasChecked = !!hasChecked;
    this.updateInputVisibility();
  }

  // 데이터가 바뀐 갱신(명령 실행/새로고침): 캐시 비우고 페이지 초기화 후 다시 조회.
  async reload() {
    this._cache = {};
    this._historyPage = 1;
    this._branchPages = {};
    await this.refresh();
  }

  // ─── 변경 사항 제공자 역할 (트리 GitQuickPickTreeProvider 와 동일 인터페이스) ──
  getCheckedFiles() {
    const result = [];
    for (const [filePath, checked] of this._checkedFiles) {
      if (checked) result.push(filePath);
    }
    return result;
  }

  // 변경 목록 갱신 시 체크 상태를 보존(기존 값 유지, 신규 파일은 false, 사라진 파일 제거).
  _reconcileChecked(changes) {
    const next = new Map();
    for (const f of changes) {
      next.set(f.filePath, this._checkedFiles.get(f.filePath) ?? false);
    }
    this._checkedFiles = next;
  }

  toggleFileView() {
    this._fileViewMode = this._fileViewMode === 'list' ? 'tree' : 'list';
    this.refresh();
  }

  // 변경 파일을 상태별로 연다 (더블클릭/우클릭 "변경 비교" 공통).
  //   수정 → HEAD diff, 삭제 → 삭제 diff, 신규 → 파일 열기, 충돌 → Merge Editor.
  _openChangedFile(filePath) {
    const cwd = getWorkspaceCwd();
    const f = this._changes.find(c => c.filePath === filePath);
    if (!cwd || !f) return;
    const args = fileOpenCommand(f, cwd);
    vscode.commands.executeCommand(args[0], ...args.slice(1));
  }

  // 커밋 버튼 활성화용 컨텍스트 키 (옵션 ON 일 때 historyProvider 가 관리).
  _updateChangesContext() {
    const hasChecked = [...this._checkedFiles.values()].some(v => v);
    vscode.commands.executeCommand('setContext', 'gitReflow.hasChanges', this._checkedFiles.size > 0);
    vscode.commands.executeCommand('setContext', 'gitReflow.hasCheckedFiles', hasChecked);
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
      this.updateInputVisibility(); // 흐름 종료 → 체크 상태 기준으로 재계산
    };
    return new Promise((resolve) => {
      this._pendingResolve = (value) => { restoreLabel(); resolve(value); };
      this.updateInputVisibility(); // 대기 시작 → 입력 강제 표시(체크와 무관)
    });
  }

  cancelWait() {
    if (this._pendingResolve) {
      const resolve = this._pendingResolve;
      this._pendingResolve = null;
      resolve(undefined);
    }
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
