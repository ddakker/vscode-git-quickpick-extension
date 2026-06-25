'use strict';

const vscode = require('vscode');
const path = require('path');

// 분리된 모듈 (src/**) — git 실행/조회/뷰/명령
const { ensureCustomAskpass, execGit, execGitSilent } = require('./src/git/exec');
const runtime = require('./src/runtime');
const { getWorkspaceCwd } = require('./src/workspace');

const {
  isGitRepo, getCurrentBranch, hasInProgressOperation,
  getStashList, getStashFiles, getChangedFiles, fileStatusLetter, fileOpenCommand,
} = require('./src/git/queries');

const { scheduleBlameUpdate, resetBlameKey, disposeBlame } = require('./src/features/blame');

const { HistoryViewProvider } = require('./src/webview/provider');

const {
  openWorkingFile, openConflictFileWithMarkers, openMergeEditors,
} = require('./src/features/conflict');

const {
  isRebaseBackupEnabled, getBackupMaxKeep, getBackupMaxAgeDays, execCleanupBackups,
} = require('./src/features/backup');

const { execPush, execPull, execForcePull, execBranchPull, execForceBranchPull } = require('./src/commands/push-pull');
const { execCommit, execSquashCommits, execAmendMessage } = require('./src/commands/commit');
const { execDeleteBranch, execDeleteRemoteBranch, createBranch, execSwitch } = require('./src/commands/branch');
const { execStageFile, execForceAdd, execRollbackFile, execDeleteFile, execAddToGitignore } = require('./src/commands/file');
const { execCreateStash, execStashRestore, execStashDrop } = require('./src/commands/stash');
const { execRebaseMerge } = require('./src/commands/rebase-merge');
const { execCherryPickCommit } = require('./src/commands/cherry-pick');
const { execReset, resetToHere } = require('./src/commands/reset');
const {
  copyHash, copyCommitMessage, openCommitFileContent, openCommitFileDiff, openCommitFileVsLocal,
  openDeletedFileDiff, openFileDiff, viewDiff,
} = require('./src/commands/diff');
const { abortOperation, continueOperation } = require('./src/commands/operation');
const {
  rebaseMerge, pullBranch, pushBranch, commitChanges, resetCommit, cherryPick, showHistory,
} = require('./src/commands/palette');




// ─── Output Channel ────────────────────────────────────────────────

let outputChannel;

// ─── i18n ───────────────────────────────────────────────────────────

const { isKo, t } = require('./src/i18n');

// 커밋 표시 포맷(필드 순서·색상·고정폭)은 히스토리/브랜치 webview 로 이전 →
// lib/commit-format.js + lib/webview-html.js + src/webview/build-state.js 가 담당.



// ─── Git Content Provider (for history diff) ────────────────────────

class GitContentProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  async provideTextDocumentContent(uri) {
    // gitreflow://empty/...  → 삭제된 파일 diff의 우측(빈 문서)용
    if (uri.authority === 'empty') return '';
    const [hash, ...pathParts] = uri.path.substring(1).split('/');
    const filePath = pathParts.join('/');
    const query = new URLSearchParams(uri.query);
    const cwd = query.get('cwd');
    if (!cwd) return '';
    try {
      const { stdout } = await execGit(['show', `${hash}:${filePath}`], cwd);
      return stdout;
    } catch {
      return '';
    }
  }
}



// ─── Sidebar TreeView ───────────────────────────────────────────────

class GitQuickPickTreeProvider {
  // 작업 공간 트리 — 변경 파일 + 스태시 (히스토리/브랜치는 webview)
  constructor() {
    this._fileViewMode = 'list';
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._branchName = '';
    this._changeCount = 0;
    this._inProgress = null;
    this._checkedFiles = new Map();
  }

  refresh(element) { this._onDidChangeTreeData.fire(element); }

  // 루트 아이템 참조 (부분 갱신용)
  _commitSectionItem = null;
  // 섹션 펼침 상태 추적 (스태시)
  _expandedSections = new Set();

  getCheckedFiles() {
    const result = [];
    for (const [filePath, checked] of this._checkedFiles) {
      if (checked) result.push(filePath);
    }
    return result;
  }

  // 내부 상태만 갱신 (UI 갱신 없음)
  async _fetchStatus() {
    const cwd = getWorkspaceCwd();
    if (!cwd || !await isGitRepo(cwd)) {
      this._branchName = '';
      this._changeCount = 0;
      this._checkedFiles.clear();
      return;
    }
    try {
      this._branchName = await getCurrentBranch(cwd);
      this._inProgress = await hasInProgressOperation(cwd);
      const files = await getChangedFiles(cwd);
      this._changeCount = files.length;
      const newChecked = new Map();
      for (const f of files) {
        if (this._checkedFiles.has(f.filePath)) {
          newChecked.set(f.filePath, this._checkedFiles.get(f.filePath));
        } else {
          newChecked.set(f.filePath, false);
        }
      }
      this._checkedFiles = newChecked;
    } catch {
      this._branchName = '';
      this._changeCount = 0;
      this._inProgress = null;
      this._checkedFiles.clear();
    }
  }

  async updateStatus() {
    await this._fetchStatus();
    if (this._inProgress || !this._commitSectionItem) {
      this.refresh();
    } else {
      this._commitSectionItem.description = this._changeCount > 0 ? t('changes', this._changeCount) : '';
      this.refresh(this._commitSectionItem);
    }
  }

  // 파일/트리 보기 전환
  toggleFileView() {
    this._fileViewMode = this._fileViewMode === 'list' ? 'tree' : 'list';
    this.refresh(this._commitSectionItem);
  }

  getTreeItem(element) { return element; }

  async getChildren(element) {
    const cwd = getWorkspaceCwd();
    if (!element) return this._getRootItems();
    if (!cwd || !await isGitRepo(cwd)) return [];

    // 히스토리/브랜치는 webview(gitQuickPickHistory)로 이전 — 트리엔 변경/스태시만.
    switch (element.contextValue) {
      case 'commitSection': return this._getChangedFileItems(cwd, null);
      case 'changedDir': return this._getChangedFileItems(cwd, element.dirPath);
      case 'stashSection': return this._getStashItems(cwd);
      case 'stashEntry': return this._getStashFileItems(cwd, element);
      default: return [];
    }
  }

  _getRootItems() {
    const items = [];

    // 진행 중인 작업 표시
    if (this._inProgress) {
      // Continue 버튼
      const continueLabel = this._inProgress === 'rebase' ? t('continueRebase')
        : this._inProgress === 'cherry-pick' ? t('continueCherryPick')
        : t('continueMerge');
      const continueItem = new vscode.TreeItem(continueLabel, vscode.TreeItemCollapsibleState.None);
      continueItem.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
      continueItem.contextValue = 'continueOperation';
      continueItem.command = { command: 'gitReflow.continueOperation', title: continueLabel };
      items.push(continueItem);

      // Abort 버튼
      const abortLabel = this._inProgress === 'rebase' ? t('abortRebase')
        : this._inProgress === 'cherry-pick' ? t('abortCherryPick')
        : t('abortMerge');
      const abortItem = new vscode.TreeItem(abortLabel, vscode.TreeItemCollapsibleState.None);
      abortItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      abortItem.contextValue = 'abortOperation';
      abortItem.command = { command: 'gitReflow.abortOperation', title: abortLabel };
      items.push(abortItem);
    }

    // 변경 사항
    const commitItem = new vscode.TreeItem(
      t('sectionCommit'),
      this._changeCount > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    commitItem.id = 'commitSection';
    commitItem.iconPath = new vscode.ThemeIcon('check');
    commitItem.contextValue = 'commitSection';
    commitItem.description = this._changeCount > 0 ? t('changes', this._changeCount) : '';
    this._commitSectionItem = commitItem;
    items.push(commitItem);

    // 히스토리·로컬/원격 브랜치 섹션은 webview(gitQuickPickHistory)로 이전됨.
    // 트리에는 변경 사항·스태시만 남는다(색상/고정폭이 불필요한 영역).

    // 스태시
    const stashExpanded = this._expandedSections.has('stashSection');
    const stashItem = new vscode.TreeItem(t('sectionStash'),
      stashExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    stashItem.iconPath = new vscode.ThemeIcon('archive');
    stashItem.contextValue = 'stashSection';
    items.push(stashItem);

    return items;
  }

  _createFileItem(f) {
    const dirPath = path.dirname(f.filePath);
    const cwd = getWorkspaceCwd();
    const fileUri = vscode.Uri.file(path.join(cwd, f.filePath));
    const dirDesc = this._fileViewMode === 'list' && dirPath !== '.' ? dirPath : '';

    const item = new vscode.TreeItem(fileUri, vscode.TreeItemCollapsibleState.None);
    item.id = `file:${f.filePath}`;
    item.description = dirDesc;
    item.filePath = f.filePath;
    item.tooltip = `${f.filePath} [${f.isConflict ? 'conflict' : f.statusCode}]`
      + ` ${f.isStaged ? 'staged' : 'unstaged'}`;

    if (f.isConflict) {
      // 충돌 파일: 경고 아이콘 + "충돌" 표시
      item.contextValue = 'fileConflict';
      item.iconPath = new vscode.ThemeIcon('warning',
        new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'));
      const conflictLabel = isKo ? '충돌' : 'conflict';
      item.description = dirDesc ? `${conflictLabel}  ${dirDesc}` : conflictLabel;
    } else if (f.statusCode === '?') {
      item.contextValue = 'fileUntracked';
    } else if (f.statusCode === 'M') {
      item.contextValue = 'fileModified';
    } else if (f.statusCode === 'D') {
      item.contextValue = 'fileDeleted';
    } else {
      item.contextValue = 'fileOther';
    }

    // 더블클릭 시 상태별 동작 (충돌/수정/신규/삭제) — 트리/인라인 공통 매핑 사용
    item.command = { command: 'gitReflow.dblClick', title: 'Open',
      arguments: fileOpenCommand(f, cwd) };

    const isChecked = this._checkedFiles.get(f.filePath) ?? false;
    item.checkboxState = isChecked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;

    return item;
  }

  async _getChangedFileItems(cwd, parentDir) {
    const files = await getChangedFiles(cwd);
    if (files.length === 0) return [];

    if (!parentDir) {
      const selectAll = new vscode.TreeItem(
        isKo ? '전체 선택/해제' : 'Select All',
        vscode.TreeItemCollapsibleState.None
      );
      selectAll.contextValue = 'selectAll';
      selectAll.iconPath = new vscode.ThemeIcon('checklist');
      const allChecked = files.length > 0
        && files.every(f => this._checkedFiles.get(f.filePath));
      selectAll.checkboxState = allChecked
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;

      const fileItems = this._fileViewMode === 'list'
        ? files.map(f => this._createFileItem(f))
        : this._buildTreeItems(files, null);
      return [selectAll, ...fileItems];
    }

    return this._buildTreeItems(await getChangedFiles(cwd), parentDir);
  }

  _buildTreeItems(files, parentDir) {
    const prefix = parentDir ? parentDir + '/' : '';
    const dirs = new Map();
    const directFiles = [];

    for (const f of files) {
      const rel = parentDir ? f.filePath.substring(prefix.length) : f.filePath;
      if (!parentDir && f.filePath === rel || parentDir && f.filePath.startsWith(prefix)) {
        const slashIdx = rel.indexOf('/');
        if (slashIdx === -1) {
          directFiles.push(f);
        } else {
          const dirName = rel.substring(0, slashIdx);
          dirs.set(dirName, (dirs.get(dirName) || 0) + 1);
        }
      }
    }

    const items = [];
    for (const [dirName, count] of dirs) {
      const fullDir = parentDir ? `${parentDir}/${dirName}` : dirName;
      const item = new vscode.TreeItem(dirName, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `${count}`;
      item.contextValue = 'changedDir';
      item.dirPath = fullDir;
      items.push(item);
    }
    for (const f of directFiles) {
      items.push(this._createFileItem(f));
    }
    return items;
  }

  async _getStashItems(cwd) {
    const stashes = await getStashList(cwd);
    return stashes.map(s => {
      const item = new vscode.TreeItem(s.message, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${s.ref}  ${s.relTime}`;
      item.tooltip = `${s.ref}\n${s.message}`;
      item.iconPath = new vscode.ThemeIcon('archive');
      item.contextValue = 'stashEntry';
      item.stashRef = s.ref;
      return item;
    });
  }

  async _getStashFileItems(cwd, element) {
    const files = await getStashFiles(cwd, element.stashRef);
    return files.map(f => {
      const letter = fileStatusLetter(f.statusCode);
      const dir = path.dirname(f.filePath);
      const item = new vscode.TreeItem(path.basename(f.filePath), vscode.TreeItemCollapsibleState.None);
      item.description = dir === '.' ? letter : `${letter}  ${dir}`;
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = 'stashFile';
      item.tooltip = f.filePath;
      item.filePath = f.filePath;
      return item;
    });
  }
}

// ─── Activation ─────────────────────────────────────────────────────

function activate(context) {
  // Output Channel 생성
  outputChannel = vscode.window.createOutputChannel('Git QuickPick');
  context.subscriptions.push(outputChannel);
  // git 실행 모듈(src/git/exec.js)이 같은 채널로 로그하도록 공유
  runtime.setOutputChannel(outputChannel);

  // 자체 askpass 스크립트 생성 (Remote-SSH에서 credential 프롬프트 지원)
  try {
    ensureCustomAskpass(context);
  } catch (err) {
    outputChannel.appendLine(`[WARN] Failed to create custom askpass: ${err.message}`);
  }

  // Git content provider 등록 (history diff용)
  const gitProvider = new GitContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('gitreflow', gitProvider)
  );

  // 히스토리·브랜치 + 커밋 입력 WebviewView 등록 (커밋 테이블 색상/고정폭 + 입력창 통합)
  const historyProvider = new HistoryViewProvider(context.globalState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('gitQuickPickHistory', historyProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  // squash/amend 등에서 커밋 입력 흐름을 재사용 (구 commitInputProvider 역할)
  const commitInputProvider = historyProvider;

  // Sidebar TreeView 등록
  const treeProvider = new GitQuickPickTreeProvider();
  const treeView = vscode.window.createTreeView('gitQuickPickView', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
    manageCheckboxStateManually: true,
  });
  context.subscriptions.push(treeView);

  // 변경 사항(체크박스/커밋)을 다루는 provider — 항상 웹뷰
  const activeChangesProvider = () => historyProvider;

  // Ctrl+Enter / 웹뷰 커밋 버튼으로 커밋
  context.subscriptions.push(
    commitInputProvider.onDidCommit(async () => {
      await execCommit(activeChangesProvider(), commitInputProvider);
      await fullRefresh();
    })
  );

  // 타이틀에 브랜치 정보 표시 ("작업 공간" + "메시지 입력")
  function updateTitleDescription() {
    let desc = '';
    if (treeProvider._branchName) {
      desc = treeProvider._changeCount > 0
        ? `${treeProvider._branchName} · ${t('changes', treeProvider._changeCount)}`
        : treeProvider._branchName;
    }
    treeView.description = desc;
    commitInputProvider.setBranchDescription(desc);
  }

  // updateStatus 후 타이틀 + 컨텍스트 갱신
  const origUpdateStatus = treeProvider.updateStatus.bind(treeProvider);
  function updateCheckedFilesContext() {
    const hasChecked = [...treeProvider._checkedFiles.values()].some(v => v);
    vscode.commands.executeCommand('setContext', 'gitReflow.hasCheckedFiles', hasChecked);
    // 트리 모드(옵션 OFF)의 체크 상태를 webview 입력창 표시(showInputWhenChecked)에 반영.
    historyProvider.setExternalCheckedState(hasChecked);
  }

  treeProvider.updateStatus = async function () {
    await origUpdateStatus();
    updateTitleDescription();
  };
  treeProvider.updateStatus();

  // 패널이 다시 보일 때 자동 새로고침
  context.subscriptions.push(
    treeView.onDidChangeVisibility(e => {
      if (e.visible) treeProvider.updateStatus();
    })
  );

  // 섹션 펼침/접힘 상태 추적 + 펼칠 때 새로고침 (변경/스태시만 — 히스토리/브랜치는 webview)
  context.subscriptions.push(
    treeView.onDidExpandElement(e => {
      const ctx = e.element.contextValue;
      treeProvider._expandedSections.add(ctx);
      if (ctx === 'commitSection') {
        treeProvider.updateStatus();
      } else if (ctx === 'stashSection') {
        treeProvider.refresh(e.element);
      }
    })
  );
  context.subscriptions.push(
    treeView.onDidCollapseElement(e => {
      treeProvider._expandedSections.delete(e.element.contextValue);
    })
  );

  // 체크박스 상태 변경 처리 (메인/변경사항 트리 공통)
  function handleCheckboxChange(provider, e) {
    for (const [item, state] of e.items) {
      const checked = state === vscode.TreeItemCheckboxState.Checked;
      if (item.contextValue === 'selectAll') {
        for (const key of provider._checkedFiles.keys()) {
          provider._checkedFiles.set(key, checked);
        }
        provider.refresh(provider._commitSectionItem);
      } else if (item.filePath) {
        provider._checkedFiles.set(item.filePath, checked);
      }
    }
    updateCheckedFilesContext();
  }
  context.subscriptions.push(
    treeView.onDidChangeCheckboxState(e => handleCheckboxChange(treeProvider, e))
  );

  // 작업 공간 상태 갱신 (트리 + 옵션 ON 이면 웹뷰 변경 목록)
  function refreshWorkspaceStatus() {
    treeProvider.updateStatus();
    historyProvider.reload();
  }

  // 파일 저장 시 갱신 (기존 파일 수정 반영)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => refreshWorkspaceStatus())
  );

  // 파일 생성/삭제 감시 — 새 파일 추가/삭제도 즉시 반영(저장 이벤트가 없어 누락되던 문제).
  // 일괄 변경(체크아웃/npm 등)에서 폭주하지 않도록 짧게 디바운스.
  // .git/ 내부 변경(fetch/commit 등 git 내부 파일)은 무시 — git 작업이 reload 루프를 유발하지 않도록.
  let fsRefreshTimer = null;
  function scheduleWorkspaceRefresh(uri) {
    if (uri && /[/\\]\.git([/\\]|$)/.test(uri.fsPath)) return;
    if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
    fsRefreshTimer = setTimeout(() => { fsRefreshTimer = null; refreshWorkspaceStatus(); }, 150);
  }
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fsWatcher.onDidCreate(scheduleWorkspaceRefresh);
  fsWatcher.onDidDelete(scheduleWorkspaceRefresh);
  fsWatcher.onDidChange(scheduleWorkspaceRefresh);
  context.subscriptions.push(fsWatcher);

  // 커밋 표시 설정이 바뀌면 즉시 반영
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitReflow.commitFieldOrder')) { treeProvider.refresh(); historyProvider.refresh(); }
      if (e.affectsConfiguration('gitReflow.authorWidth')) {
        historyProvider.refresh();
      }
      if (e.affectsConfiguration('gitReflow.messageInputPosition')) {
        historyProvider.updateInputPosition();
      }
      if (e.affectsConfiguration('gitReflow.showInputWhenChecked')) {
        historyProvider.updateInputVisibility();
      }
      // 히스토리 개수 변경 → 캐시 무효화 후 다시 조회
      if (e.affectsConfiguration('gitReflow.historyCount')) {
        historyProvider.reload();
      }
      // 언어 변경은 로드 시점에 해석되므로 창 새로고침 안내
      if (e.affectsConfiguration('gitReflow.language')) {
        vscode.window.showInformationMessage(t('reloadForLanguage'), t('reloadWindow'))
          .then(pick => {
            if (pick === t('reloadWindow')) vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
      }
    })
  );

  // diff 에디터에서 변경사항을 모두 되돌렸을 때 자동 저장
  // (버퍼 내용이 HEAD와 동일해지면 저장 → git status가 clean으로 인식 → 목록 갱신)
  const diffRevertTimers = new Map(); // filePath → timer
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const doc = e.document;
      if (!doc.isDirty || doc.isUntitled || doc.uri.scheme !== 'file') return;
      const cwd = getWorkspaceCwd();
      if (!cwd) return;
      const filePath = vscode.workspace.asRelativePath(doc.uri, false);
      if (!filePath || filePath === doc.uri.fsPath) return;
      // 변경사항 목록에 있는 파일만 체크 (불필요한 git 조회 방지)
      const provider = activeChangesProvider();
      const isTracked = provider._changes
        ? provider._changes.some(f => f.filePath === filePath)
        : provider._checkedFiles?.has(filePath);
      if (!isTracked) return;
      if (diffRevertTimers.has(filePath)) clearTimeout(diffRevertTimers.get(filePath));
      diffRevertTimers.set(filePath, setTimeout(async () => {
        diffRevertTimers.delete(filePath);
        try {
          if (!doc.isDirty) return;
          const { stdout: headContent } = await execGitSilent(['show', `HEAD:${filePath}`], cwd);
          if (doc.getText() === headContent) {
            await doc.save();
          }
        } catch { /* HEAD에 파일 없거나 git 오류 시 무시 */ }
      }, 400));
    })
  );

  // ─── Inline Git Blame ──────────────────────────────────────────────
  // 커서 이동 시 현재 줄의 blame 정보를 인라인으로 표시
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(e => {
      scheduleBlameUpdate(e.textEditor);
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        resetBlameKey();
        scheduleBlameUpdate(editor);
      }
    })
  );
  // 파일 저장 시 blame 캐시 초기화 후 갱신
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      resetBlameKey();
      const editor = vscode.window.activeTextEditor;
      if (editor) scheduleBlameUpdate(editor);
    })
  );
  // 초기 에디터에 대해 blame 표시
  if (vscode.window.activeTextEditor) {
    scheduleBlameUpdate(vscode.window.activeTextEditor);
  }

  // 전체 트리 갱신 (상태 + UI + 컨텍스트)
  async function fullRefresh() {
    await treeProvider._fetchStatus();
    treeProvider._commitSectionItem = null;
    treeProvider.refresh();
    updateTitleDescription();
    historyProvider.reload(); // 데이터 바뀜 → 캐시 무효화 후 갱신
  }
  runtime.setFullRefreshFn(fullRefresh);

  // 명령 실행 후 전체 트리 갱신 래퍼
  function withRefresh(fn) {
    return async (...args) => {
      await fn(...args);
      await fullRefresh();
    };
  }

  // 더블클릭 프록시 커맨드
  let dblClickLastKey = null;
  let dblClickLastTime = 0;

  const cmds = {
    'gitReflow.dblClick': (targetCmd, ...args) => {
      const key = targetCmd + JSON.stringify(args);
      const now = Date.now();
      if (dblClickLastKey === key && now - dblClickLastTime < 500) {
        dblClickLastKey = null;
        vscode.commands.executeCommand(targetCmd, ...args);
      } else {
        dblClickLastKey = key;
      }
      dblClickLastTime = now;
    },
    // 사이드바 커밋
    'gitReflow.execCommit': withRefresh(() => execCommit(activeChangesProvider(), commitInputProvider)),
    'gitReflow.toggleFileView': () => activeChangesProvider().toggleFileView(),
    'gitReflow.stageFile': withRefresh((item) => execStageFile(item)),
    'gitReflow.rollbackFile': withRefresh((item) => execRollbackFile(item)),
    'gitReflow.deleteFile': withRefresh((item) => execDeleteFile(item)),
    'gitReflow.addToGitignore': withRefresh((item) => execAddToGitignore(item)),
    'gitReflow.addForce': withRefresh((uri, uris) => execForceAdd(uri, uris)),
    // 타이틀 바 명령
    'gitReflow.execPush': withRefresh(() => execPush(false)),
    'gitReflow.execForcePush': withRefresh(() => execPush(true)),
    'gitReflow.execForcePull': withRefresh(() => execForcePull()),
    'gitReflow.execPull': withRefresh(() => execPull()),
    'gitReflow.refreshView': async () => {
      await fullRefresh();
    },
    // 사이드바 인라인 액션 명령
    'gitReflow.execRebase': withRefresh((item) => execRebaseMerge(item, 'rebase')),
    'gitReflow.execMerge': withRefresh((item) => execRebaseMerge(item, 'merge')),
    'gitReflow.execCherryPick': withRefresh((item) => execCherryPickCommit(item)),
    'gitReflow.execSoftReset': withRefresh((item) => execReset(item, '--soft')),
    'gitReflow.execHardReset': withRefresh((item) => execReset(item, '--hard')),
    'gitReflow.execSwitch': withRefresh((item) => execSwitch(item)),
    'gitReflow.openFileDiff': (fileUri) => openFileDiff(fileUri),
    'gitReflow.openDeletedFileDiff': (filePath) => openDeletedFileDiff(filePath),
    'gitReflow.openCommitFileDiff': (hash, filePath, cwd) => openCommitFileDiff(hash, filePath, cwd),
    'gitReflow.openCommitFileContent': (hash, filePath, cwd) => openCommitFileContent(hash, filePath, cwd),
    'gitReflow.openCommitFileVsLocal': (item) => {
      if (!item) return;
      const cwd = getWorkspaceCwd();
      if (!cwd || !item.commitHash || !item.tooltip) return;
      openCommitFileVsLocal(item.commitHash, item.tooltip, cwd);
    },
    'gitReflow.jumpToSource': (item) => {
      if (!item) return;
      // 변경사항 파일은 filePath, 히스토리 파일은 tooltip에 상대경로
      openWorkingFile(item.filePath || item.tooltip);
    },
    // 충돌 파일을 일반 에디터로 열기 (충돌 마커 <<<<<<< 가 보이는 워킹트리 파일)
    'gitReflow.openConflictInEditor': (arg) => {
      const cwd = getWorkspaceCwd();
      const file = typeof arg === 'string' ? arg : arg && arg.filePath;
      openConflictFileWithMarkers(cwd, file);
    },
    'gitReflow.acceptMerge': withRefresh((item) => execStageFile(item)),
    // 충돌 파일을 3-way Merge Editor로 열기
    'gitReflow.openConflictMergeEditor': (arg) => {
      const cwd = getWorkspaceCwd();
      const filePath = typeof arg === 'string' ? arg : arg && arg.filePath;
      if (!cwd || !filePath) return;
      openMergeEditors(cwd, [filePath]);
    },
    'gitReflow.copyPath': (item) => {
      if (!item || !item.filePath) return;
      const cwd = getWorkspaceCwd();
      if (!cwd) return;
      vscode.env.clipboard.writeText(path.join(cwd, item.filePath));
    },
    'gitReflow.copyRelativePath': (item) => {
      if (!item || !item.filePath) return;
      vscode.env.clipboard.writeText(path.normalize(item.filePath));
    },
    'gitReflow.execInteractiveRebase': withRefresh((item) => execSquashCommits(item, commitInputProvider)),
    'gitReflow.execAmendMessage': withRefresh((item) => execAmendMessage(item, commitInputProvider)),
    'gitReflow.abortOperation': withRefresh(() => abortOperation()),
    'gitReflow.continueOperation': withRefresh(() => continueOperation()),
    'gitReflow.copyHash': (item) => copyHash(item),
    'gitReflow.copyMessage': (item) => copyCommitMessage(item),
    'gitReflow.viewDiff': (item) => viewDiff(item),
    'gitReflow.resetToHere': withRefresh((item) => resetToHere(item)),
    'gitReflow.createBranch': withRefresh(() => createBranch()),
    'gitReflow.execBranchPull': withRefresh((item) => execBranchPull(item)),
    'gitReflow.execForceBranchPull': withRefresh((item) => execForceBranchPull(item)),
    'gitReflow.execDeleteBranch': withRefresh((item) => execDeleteBranch(item)),
    'gitReflow.cleanupBackups': withRefresh(() => execCleanupBackups()),
    'gitReflow.createStash': withRefresh(() => execCreateStash()),
    'gitReflow.stashPop': withRefresh((item) => execStashRestore(item, false)),
    'gitReflow.stashApply': withRefresh((item) => execStashRestore(item, true)),
    'gitReflow.stashDrop': withRefresh((item) => execStashDrop(item)),
    'gitReflow.openSettings': () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
    'gitReflow.execDeleteRemoteBranch': withRefresh((item) => execDeleteRemoteBranch(item)),
    // Command Palette 명령 (하위 호환)
    'gitReflow.rebasemergeLocal': withRefresh(() => rebaseMerge(false)),
    'gitReflow.rebasemergeRemote': withRefresh(() => rebaseMerge(true)),
    'gitReflow.pullBranch': withRefresh(pullBranch),
    'gitReflow.push': withRefresh(pushBranch),
    'gitReflow.commit': withRefresh(commitChanges),
    'gitReflow.reset': withRefresh(resetCommit),
    'gitReflow.cherryPick': withRefresh(cherryPick),
    'gitReflow.history': withRefresh(showHistory),
    'gitReflow.stash': withRefresh(() => execCreateStash()),
  };

  for (const [id, fn] of Object.entries(cmds)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, fn)
    );
  }
}

function deactivate() {
  disposeBlame();
}

module.exports = { activate, deactivate };

// Test-only internals — 테스트용. 순수 헬퍼는 lib/*.js에서 직접 import.
// 런타임 의존하지 말 것
module.exports._internals = {
  t, getCurrentBranch, fileStatusLetter,
  isRebaseBackupEnabled, getBackupMaxKeep, getBackupMaxAgeDays,
};
