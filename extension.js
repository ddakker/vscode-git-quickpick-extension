'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);

// ─── Output Channel ────────────────────────────────────────────────

let outputChannel;
let _fullRefreshFn = null;

// ─── i18n ───────────────────────────────────────────────────────────

const isKo = vscode.env.language.startsWith('ko');

const messages = {
  noWorkspace:      ['워크스페이스가 열려있지 않습니다.', 'No workspace is open.'],
  notGitRepo:       ['Git 저장소가 아닙니다.', 'Not a git repository.'],
  selectBranch:     ['브랜치를 선택하세요', 'Select a branch'],
  selectAction:     ['작업을 선택하세요', 'Select an action'],
  rebaseOnto:       ['{0} 위에 리베이스', 'Rebase onto {0}'],
  merge:            ['{0} 머지', 'Merge {0}'],
  currentBranch:    ['현재 브랜치: {0}', 'Current branch: {0}'],
  current:          ['(현재)', '(current)'],
  noBranches:       ['선택 가능한 브랜치가 없습니다.', 'No branches available.'],
  fetchingRemotes:  ['원격 저장소 가져오는 중...', 'Fetching remote branches...'],
  executing:        ['실행 중: {0}', 'Executing: {0}'],
  success:          ['완료: {0}', 'Done: {0}'],
  successWithCount: ['{0} 완료 ({1}개 커밋)', 'Done: {0} ({1} commits)'],
  failed:           ['실패: {0}', 'Failed: {0}'],
  pullSuccess:      ['{0} 브랜치 풀 완료', 'Pulled branch {0}'],
  conflictDetected: [
    '충돌이 발생했습니다. 수동으로 해결하세요.',
    'Conflict detected. Please resolve manually.'
  ],
  rebaseContinueHint: [
    '충돌 해결 후 터미널에서 git rebase --continue를 실행하세요.',
    'After resolving conflicts, run git rebase --continue in terminal.'
  ],
  detachedHead: [
    'Detached HEAD 상태입니다. pull을 실행할 수 없습니다.',
    'Cannot pull in detached HEAD state.'
  ],
  detachedHeadWarn: [
    'Detached HEAD 상태입니다.',
    'Currently in detached HEAD state.'
  ],
  inProgressRebase: [
    '이미 rebase가 진행 중입니다. abort 또는 continue 하세요.',
    'A rebase is already in progress. Abort or continue it first.'
  ],
  inProgressMerge: [
    '이미 merge가 진행 중입니다. abort 또는 continue 하세요.',
    'A merge is already in progress. Abort or continue it first.'
  ],
  branchDiverged: [
    '{0} 브랜치가 분기되었습니다. checkout 후 수동으로 pull하세요.',
    'Branch {0} has diverged. Checkout and pull manually.'
  ],
  confirmRebase:    ['{0}을(를) {1} 위에 리베이스합니까?', 'Rebase {0} onto {1}?'],
  confirmMerge:     ['{1}을(를) {0}에 머지합니까?', 'Merge {1} into {0}?'],
  rebaseOnto:       ['Rebase onto {0}', 'Rebase onto {0}'],
  mergeInto:        ['Merge into {0}', 'Merge into {0}'],
  yes:              ['예', 'Yes'],
  cancel:           ['취소', 'Cancel'],
  pull:             ['Pull', 'Pull'],
  pullRebase:       ['Pull --rebase', 'Pull --rebase'],
  resolveInEditor:  ['에디터에서 해결', 'Resolve in Editor'],
  abortRebase:      ['리베이스 취소', 'Abort Rebase'],
  continueRebase:   ['리베이스 계속', 'Continue Rebase'],
  abortMerge:       ['머지 취소', 'Abort Merge'],
  continueMerge:    ['머지 계속', 'Continue Merge'],
  openTerminal:     ['터미널 열기', 'Open Terminal'],
  openingMergeEditor: [
    '충돌 파일 {0}개를 Merge Editor에서 엽니다.',
    'Opening {0} conflicted file(s) in Merge Editor.'
  ],
  // ─── Push ──────────────────────────────────────────────
  push:               ['Push', 'Push'],
  pushForce:          ['Force Push', 'Force Push'],
  pushSuccess:        ['{0} 브랜치 푸시 완료', 'Pushed branch {0}'],
  forcePushConfirm:   ['{0} 브랜치를 Force Push합니까? 원격 히스토리가 덮어씌워집니다.', 'Force push {0}? This will overwrite remote history.'],
  detachedHeadPush:   ['Detached HEAD 상태입니다. push를 실행할 수 없습니다.', 'Cannot push in detached HEAD state.'],
  // ─── Commit ────────────────────────────────────────────
  selectFiles:        ['커밋할 파일을 선택하세요', 'Select files to commit'],
  newMessage:         ['✏️ 새 메시지 입력', '✏️ Enter new message'],
  noChanges:          ['변경된 파일이 없습니다.', 'No changed files.'],
  commitSuccess:      ['커밋 완료: {0}', 'Committed: {0}'],
  enterCommitMsg:     ['커밋 메시지를 입력하세요', 'Enter commit message'],
  selectCommitMsg:    ['커밋 메시지를 선택하세요', 'Select commit message'],
  // ─── Reset ─────────────────────────────────────────────
  resetSoft:          ['--soft (staged로 유지)', '--soft (keep changes staged)'],
  resetHard:          ['--hard (모든 변경 삭제) ⚠️', '--hard (discard all changes) ⚠️'],
  selectResetMode:    ['리셋 모드를 선택하세요', 'Select reset mode'],
  confirmHardReset:   ['HEAD를 {0}으로 hard reset합니까? 모든 변경이 삭제됩니다.', 'Hard reset to {0}? All changes will be lost.'],
  resetSuccess:       ['{0}으로 리셋 완료', 'Reset to {0}'],
  selectCommit:       ['커밋을 선택하세요', 'Select a commit'],
  noCommits:          ['커밋이 없습니다.', 'No commits found.'],
  // ─── Cherry-pick ───────────────────────────────────────
  cherryPickSuccess:  ['체리픽 완료: {0}', 'Cherry-picked: {0}'],
  abortCherryPick:    ['체리픽 취소', 'Abort Cherry Pick'],
  continueCherryPick: ['체리픽 계속', 'Continue Cherry Pick'],
  cherryPickContinueHint: [
    '충돌 해결 후 터미널에서 git cherry-pick --continue를 실행하세요.',
    'After resolving conflicts, run git cherry-pick --continue in terminal.'
  ],
  inProgressCherryPick: [
    '이미 cherry-pick이 진행 중입니다. abort 또는 continue 하세요.',
    'A cherry-pick is already in progress. Abort or continue it first.'
  ],
  // ─── History ───────────────────────────────────────────
  historyTitle:       ['히스토리', 'History'],
  copyHash:           ['📋 해시 복사', '📋 Copy hash'],
  viewDiff:           ['📄 diff 보기', '📄 View diff'],
  cherryPickAction:   ['🍒 체리픽', '🍒 Cherry pick'],
  resetToHere:        ['⏪ 여기로 리셋', '⏪ Reset to here'],
  hashCopied:         ['해시가 클립보드에 복사되었습니다: {0}', 'Hash copied to clipboard: {0}'],
  selectFile:         ['파일을 선택하세요', 'Select a file'],
  noDiffFiles:        ['변경된 파일이 없습니다.', 'No changed files in this commit.'],
  selectHistoryAction: ['작업을 선택하세요', 'Select an action'],
  // ─── Sidebar sections ──────────────────────────────────
  sectionCommit:      ['변경 사항', 'Changes'],
  sectionHistory:     ['히스토리', 'History'],
  sectionLocalBranch: ['로컬 브랜치', 'Local Branches'],
  sectionRemoteBranch:['원격 브랜치', 'Remote Branches'],
  changes:            ['{0}개 변경', '{0} changes'],
  switchSuccess:      ['{0} 브랜치로 전환 완료', 'Switched to branch {0}'],
  enterBranchName:    ['새 브랜치 이름을 입력하세요', 'Enter new branch name'],
  branchCreated:      ['브랜치 생성 완료: {0}', 'Branch created: {0}'],
};

function t(key, ...args) {
  const msg = messages[key];
  if (!msg) return key;
  const text = isKo ? msg[0] : msg[1];
  return args.length
    ? text.replace(/\{(\d)\}/g, (_, i) => args[i] ?? '')
    : text;
}

// ─── Git Helpers ────────────────────────────────────────────────────

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

// 내부 헬퍼용 (로그 없이 실행 — status, rev-parse 등 빈번한 조회)
async function execGitSilent(args, cwd, options = {}) {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024,
    ...options,
  });
}

// 사용자 명령용 (출력 로그에 기록 + 자동 표시)
async function execGit(args, cwd, options = {}) {
  const cmdStr = `git ${args.join(' ')}`;
  if (outputChannel) {
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] $ ${cmdStr}`);
    outputChannel.show(true); // 출력 패널 자동 표시 (포커스 안 뺏김)
  }
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 1024 * 1024,
      ...options,
    });
    if (outputChannel) {
      if (result.stdout && result.stdout.trim()) {
        outputChannel.appendLine(result.stdout.trimEnd());
      }
      if (result.stderr && result.stderr.trim()) {
        outputChannel.appendLine(result.stderr.trimEnd());
      }
      outputChannel.appendLine('');
    }
    return result;
  } catch (err) {
    if (outputChannel) {
      const errMsg = (err.stderr || '') + (err.stdout || '') || err.message || String(err);
      outputChannel.appendLine(`[ERROR] ${errMsg.trimEnd()}`);
      outputChannel.appendLine('');
    }
    throw err;
  }
}

async function isGitRepo(cwd) {
  try {
    await execGitSilent(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

async function getCurrentBranch(cwd) {
  const { stdout } = await execGitSilent(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return stdout.trim();
}

async function getLocalBranches(cwd) {
  const { stdout } = await execGitSilent([
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(subject)%09%(committerdate:relative)',
    'refs/heads/',
  ], cwd);
  if (!stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [name, subject, relTime] = line.split('\t');
    return { name, description: `${subject} (${relTime})` };
  });
}

async function getRemoteBranches(cwd) {
  const { stdout } = await execGitSilent([
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(subject)%09%(committerdate:relative)',
    'refs/remotes/',
  ], cwd);
  if (!stdout.trim()) return [];
  return stdout.trim().split('\n')
    .filter(line => !line.includes('->'))
    .map(line => {
      const [name, subject, relTime] = line.split('\t');
      return { name, description: `${subject} (${relTime})` };
    });
}

async function fetchAll(cwd) {
  await execGit(['fetch', '--all'], cwd, { timeout: 30000 });
}

async function isDetachedHead(cwd) {
  const branch = await getCurrentBranch(cwd);
  return branch === 'HEAD';
}

async function hasInProgressOperation(cwd) {
  try {
    const { stdout } = await execGitSilent(['rev-parse', '--git-dir'], cwd);
    const gitDir = path.resolve(cwd, stdout.trim());
    if (fs.existsSync(path.join(gitDir, 'rebase-merge'))
      || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
      return 'rebase';
    }
    if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
      return 'merge';
    }
    if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
      return 'cherry-pick';
    }
  } catch { /* ignore */ }
  return null;
}

async function getChangedFiles(cwd) {
  const { stdout } = await execGitSilent(['status', '--porcelain', '--no-renames'], cwd);
  if (!stdout.trim()) return [];

  // git check-ignore로 무시 대상 필터링
  const files = stdout.trimEnd().split('\n').map(line => {
    const indexStatus = line[0];
    const workStatus = line[1];
    const filePath = line.substring(3);
    const isStaged = indexStatus !== ' ' && indexStatus !== '?';
    const statusCode = isStaged ? indexStatus : (workStatus === '?' ? '?' : workStatus);
    return { filePath, statusCode, isStaged };
  });

  // untracked 파일 중 gitignore 대상 필터링
  const untrackedPaths = files.filter(f => f.statusCode === '?').map(f => f.filePath);
  if (untrackedPaths.length > 0) {
    try {
      const { stdout: ignored } = await execGitSilent(
        ['check-ignore', ...untrackedPaths], cwd
      );
      const ignoredSet = new Set(ignored.trim().split('\n').filter(Boolean));
      return files.filter(f => f.statusCode !== '?' || !ignoredSet.has(f.filePath));
    } catch {
      // check-ignore가 매칭 없으면 exit code 1 → 전부 유효
    }
  }
  return files;
}

// ─── Validation ─────────────────────────────────────────────────────

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

// ─── QuickPick Helpers (for Command Palette backward compat) ───────

async function showBranchPicker(branches, currentBranch) {
  const items = branches.map(({ name, description }) => ({
    label: name,
    description: name === currentBranch
      ? `${t('current')} ${description}`
      : description,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `${t('selectBranch')} (${t('currentBranch', currentBranch)})`,
  });
  return selected ? selected.label : undefined;
}

async function showActionPicker(branchName) {
  const items = [
    { label: `$(git-merge) ${t('rebaseOnto', branchName)}`, value: 'rebase' },
    { label: `$(git-pull-request) ${t('merge', branchName)}`, value: 'merge' },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: t('selectAction'),
  });
  return selected ? selected.value : undefined;
}

async function showPullActionPicker() {
  const items = [
    { label: `$(cloud-download) ${t('pull')}`, value: 'pull' },
    { label: `$(git-merge) ${t('pullRebase')}`, value: 'pull-rebase' },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: t('selectAction'),
  });
  return selected ? selected.value : undefined;
}

// ─── Commit Picker (shared) ────────────────────────────────────────

function formatCommitDate(isoDate) {
  const d = new Date(isoDate);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const hh = String(h % 12 || 12).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${ampm} ${hh}:${mm}`;
}

async function getCommitLog(cwd, options = {}) {
  const { branch, count = 30 } = options;
  const args = ['log', '--format=%H%x09%s%x09%an%x09%aI', `-n`, String(count)];
  if (branch) args.push(branch);
  try {
    const { stdout } = await execGitSilent(args, cwd);
    if (!stdout.trim()) return [];
    return stdout.trim().split('\n').map(line => {
      const [hash, message, author, dateISO] = line.split('\t');
      return { hash, message, author, date: formatCommitDate(dateISO) };
    });
  } catch {
    return [];
  }
}

async function showCommitPicker(cwd, options = {}) {
  const { branch, count = 30, title } = options;
  const commits = await getCommitLog(cwd, { branch, count });
  if (commits.length === 0) {
    vscode.window.showInformationMessage(t('noCommits'));
    return undefined;
  }
  const items = commits.map(c => ({
    label: `${c.hash.substring(0, 8)} ${c.message}`,
    description: `${c.author}  ${c.date}`,
    hash: c.hash,
    message: c.message,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: title || t('selectCommit'),
  });
  return selected ? { hash: selected.hash, message: selected.message } : undefined;
}

// ─── Commit Message WebviewView ─────────────────────────────────────

// ─── Commit Message WebviewView ─────────────────────────────────────

// ─── Commit Input WebviewView ───────────────────────────────────────

class CommitInputViewProvider {
  constructor(globalState) {
    this._view = null;
    this._message = '';
    this._globalState = globalState;
    this._onDidCommit = new vscode.EventEmitter();
    this.onDidCommit = this._onDidCommit.event;
  }

  getMessage() { return this._message; }

  clearMessage() {
    this._message = '';
    if (this._view) {
      this._view.webview.postMessage({ type: 'clear' });
    }
  }

  getHistory() {
    return this._globalState.get('commitHistory', []);
  }

  addHistory(msg) {
    let history = this.getHistory().filter(h => h !== msg);
    history.unshift(msg);
    if (history.length > 5) history = history.slice(0, 5);
    this._globalState.update('commitHistory', history);
  }

  setMessage(msg) {
    this._message = msg;
    if (this._view) {
      this._view.webview.postMessage({ type: 'restore', value: msg });
    }
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    if (this._message) {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'restore', value: this._message });
      }, 100);
    }

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'input') {
        this._message = msg.value;
      } else if (msg.type === 'commit') {
        this._message = msg.value;
        this._onDidCommit.fire(msg.value);
      } else if (msg.type === 'showHistory') {
        this._showHistoryQuickPick();
      }
    });
  }

  async _showHistoryQuickPick() {
    const history = this.getHistory();
    if (history.length === 0) {
      const label = isKo ? '커밋 메시지 히스토리가 없습니다' : 'No commit message history';
      vscode.window.showInformationMessage(label);
      return;
    }
    const items = history.map(msg => ({ label: msg }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: isKo ? '최근 커밋 메시지 선택' : 'Select recent commit message',
    });
    if (picked) {
      this.setMessage(picked.label);
    }
  }

  _getHtml() {
    const placeholder = isKo ? '커밋 메시지 (Ctrl+Enter로 커밋)' : 'Commit message (Ctrl+Enter to commit)';
    const commitLabel = isKo ? '커밋' : 'Commit';
    const recentLabel = isKo ? '최근 메시지' : 'Recent messages';
    return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; background: transparent; }
  body {
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .input-wrap {
    flex: 1;
    display: flex;
    align-items: stretch;
    gap: 2px;
    min-height: 26px;
  }
  textarea {
    flex: 1;
    padding: 4px 6px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    background: var(--vscode-input-background, #1e1e1e);
    color: var(--vscode-input-foreground, #cccccc);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    resize: none;
    outline: none;
    border-radius: 2px;
    overflow-y: auto;
    line-height: 1.4;
  }
  textarea:focus { border-color: var(--vscode-focusBorder, #007fd4); }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground, #888); }
  #historyBtn {
    flex-shrink: 0;
    width: 26px;
    align-self: flex-start;
    height: 26px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    background: var(--vscode-input-background, #1e1e1e);
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #historyBtn:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
    color: var(--vscode-foreground, #ccc);
  }
  #commitBtn {
    flex-shrink: 0;
    width: 100%;
    margin-top: 4px;
    padding: 4px 0;
    border: none;
    border-radius: 2px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    cursor: pointer;
  }
  #commitBtn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
</style>
</head>
<body>
  <div class="input-wrap">
    <textarea id="msg" rows="1" placeholder="${placeholder}"></textarea>
    <button id="historyBtn" title="${recentLabel}"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.2a5.8 5.8 0 1 1 0 11.6A5.8 5.8 0 0 1 8 2.2zM7.4 4v4.4l3.2 1.9.6-1-2.6-1.5V4H7.4z"/></svg></button>
  </div>
  <button id="commitBtn">&#x2713; ${commitLabel}</button>
  <script>
    const vscode = acquireVsCodeApi();
    const ta = document.getElementById('msg');

    document.getElementById('historyBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'showHistory' });
    });

    ta.addEventListener('input', () => {
      vscode.postMessage({ type: 'input', value: ta.value });
    });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (ta.value.trim()) {
          vscode.postMessage({ type: 'commit', value: ta.value });
        }
      }
    });

    document.getElementById('commitBtn').addEventListener('click', () => {
      if (ta.value.trim()) {
        vscode.postMessage({ type: 'commit', value: ta.value });
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data.type === 'clear') { ta.value = ''; }
      if (e.data.type === 'restore') { ta.value = e.data.value; }
    });
  </script>
</body>
</html>`;
  }
}

// ─── Git Content Provider (for history diff) ────────────────────────

class GitContentProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  async provideTextDocumentContent(uri) {
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

// ─── Conflict Handling ──────────────────────────────────────────────

function isConflict(errorMsg) {
  return /CONFLICT|MERGE_CONFLICT|merge conflict/i.test(errorMsg);
}

async function getConflictedFiles(cwd) {
  try {
    const { stdout } = await execGit(['diff', '--name-only', '--diff-filter=U'], cwd);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function openMergeEditors(cwd, files) {
  const tmpDir = path.join(os.tmpdir(), 'git-reflow-merge');
  // 이전 임시 파일 정리
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const file of files) {
    const fileName = path.basename(file);
    const resultUri = vscode.Uri.file(path.join(cwd, file));
    try {
      // git에서 base(:1), ours(:2), theirs(:3) 추출
      let baseContent = '', oursContent = '', theirsContent = '';
      try { baseContent = (await execGitSilent(['show', `:1:${file}`], cwd)).stdout; } catch { /* no base */ }
      try { oursContent = (await execGitSilent(['show', `:2:${file}`], cwd)).stdout; } catch { /* no ours */ }
      try { theirsContent = (await execGitSilent(['show', `:3:${file}`], cwd)).stdout; } catch { /* no theirs */ }

      // 임시 파일 생성
      const ts = Date.now();
      const basePath = path.join(tmpDir, `${ts}_BASE_${fileName}`);
      const oursPath = path.join(tmpDir, `${ts}_OURS_${fileName}`);
      const theirsPath = path.join(tmpDir, `${ts}_THEIRS_${fileName}`);
      fs.writeFileSync(basePath, baseContent);
      fs.writeFileSync(oursPath, oursContent);
      fs.writeFileSync(theirsPath, theirsContent);

      // VS Code 내장 3-way merge editor 열기
      await vscode.commands.executeCommand('_open.mergeEditor', {
        $type: 'uri',
        base: vscode.Uri.file(basePath),
        input1: { uri: vscode.Uri.file(oursPath), title: 'Current (Ours)' },
        input2: { uri: vscode.Uri.file(theirsPath), title: 'Incoming (Theirs)' },
        result: resultUri,
      });
    } catch {
      // merge editor 실패 시 일반 에디터로 열기
      await vscode.commands.executeCommand('vscode.open', resultUri);
    }
  }
}

async function handleGitError(err, action, cwd) {
  const msg = err.stderr || err.stdout || err.message || String(err);

  if (isConflict(msg)) {
    const abortLabel = action === 'rebase' ? t('abortRebase')
      : action === 'cherry-pick' ? t('abortCherryPick')
      : t('abortMerge');
    const abortCmd = action === 'rebase' ? ['rebase', '--abort']
      : action === 'cherry-pick' ? ['cherry-pick', '--abort']
      : ['merge', '--abort'];

    const conflictFiles = await getConflictedFiles(cwd);

    // 충돌 감지 즉시 트리 갱신 (abort 버튼 표시)
    if (_fullRefreshFn) await _fullRefreshFn();

    const choice = await vscode.window.showWarningMessage(
      t('conflictDetected'),
      t('resolveInEditor'),
      abortLabel,
      t('openTerminal')
    );

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
      await execGit(abortCmd, cwd);
    } else if (choice === t('openTerminal')) {
      const terminal = vscode.window.createTerminal({ cwd });
      terminal.show();
    }
  } else {
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

// ─── Sidebar Inline Action Handlers ─────────────────────────────────

async function execPush(force) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHeadPush'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);

  if (force) {
    const confirm = await vscode.window.showWarningMessage(
      t('forcePushConfirm', currentBranch),
      { modal: false }, t('yes'), t('cancel')
    );
    if (confirm !== t('yes')) return;
  }

  let hasUpstream = true;
  try {
    await execGitSilent(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`], cwd);
  } catch {
    hasUpstream = false;
  }

  const pushArgs = ['push'];
  if (force) pushArgs.push('--force');
  if (!hasUpstream) pushArgs.push('--set-upstream', 'origin', currentBranch);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${pushArgs.join(' ')}`) },
      () => execGit(pushArgs, cwd)
    );
    vscode.window.showInformationMessage(t('pushSuccess', currentBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execCommit(treeProvider, commitInputProvider) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const checkedFiles = treeProvider.getCheckedFiles();
  if (checkedFiles.length === 0) {
    vscode.window.showInformationMessage(t('noChanges'));
    return;
  }

  const commitMessage = commitInputProvider.getMessage().trim();
  if (!commitMessage) {
    vscode.window.showWarningMessage(t('enterCommitMsg'));
    return;
  }

  try {
    try {
      await execGit(['reset', 'HEAD'], cwd);
    } catch {
      // initial commit: no HEAD yet
    }
    await execGit(['add', '--', ...checkedFiles], cwd);
    await execGit(['commit', '-m', commitMessage], cwd);
    vscode.window.showInformationMessage(t('commitSuccess', commitMessage));
    commitInputProvider.addHistory(commitMessage);
    commitInputProvider.clearMessage();
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execPull() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHead'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', 'git pull') },
      () => execGit(['pull'], cwd)
    );
    vscode.window.showInformationMessage(t('pullSuccess', currentBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execBranchPull(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const currentBranch = await getCurrentBranch(cwd);

  try {
    if (branchName === currentBranch) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git pull origin ${branchName}`) },
        () => execGit(['pull', 'origin', branchName], cwd)
      );
    } else {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch origin ${branchName}`) },
        async () => {
          await execGit(['fetch', 'origin', `${branchName}:${branchName}`], cwd);
        }
      );
    }
    vscode.window.showInformationMessage(t('pullSuccess', branchName));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execForceBranchPull(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const currentBranch = await getCurrentBranch(cwd);
  const msg1 = isKo
    ? `${branchName} 브랜치를 강제로 원격에서 가져옵니다. 로컬 변경사항이 사라집니다. 계속하시겠습니까?`
    : `Force pull ${branchName} from remote. Local changes will be lost. Continue?`;
  const confirm1 = await vscode.window.showWarningMessage(msg1, { modal: true }, t('yes'));
  if (confirm1 !== t('yes')) return;

  const msg2 = isKo
    ? `정말로 ${branchName} 브랜치를 강제로 덮어쓰시겠습니까? 이 작업은 되돌릴 수 없습니다.`
    : `Are you absolutely sure you want to overwrite ${branchName}? This cannot be undone.`;
  const confirm2 = await vscode.window.showWarningMessage(msg2, { modal: true }, t('yes'));
  if (confirm2 !== t('yes')) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch + reset ${branchName}`) },
      async () => {
        await execGit(['fetch', 'origin', branchName], cwd);
        if (branchName === currentBranch) {
          await execGit(['reset', '--hard', `origin/${branchName}`], cwd);
        } else {
          await execGit(['branch', '-f', branchName, `origin/${branchName}`], cwd);
        }
      }
    );
    vscode.window.showInformationMessage(
      isKo ? `${branchName} 브랜치를 강제로 가져왔습니다.` : `Force pulled ${branchName} successfully.`
    );
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execStageFile(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;
  await execGit(['add', '--', item.filePath], cwd);
}

async function execRollbackFile(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const fileName = path.basename(item.filePath);
  const confirm = await vscode.window.showWarningMessage(
    isKo ? `${fileName} 변경을 되돌립니까?` : `Discard changes in ${fileName}?`,
    { modal: false }, t('yes'), t('cancel')
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
    { modal: false }, t('yes'), t('cancel')
  );
  if (confirm !== t('yes')) return;

  const fullPath = path.join(cwd, item.filePath);
  try {
    fs.unlinkSync(fullPath);
  } catch {
    await execGit(['rm', '-f', '--', item.filePath], cwd);
  }
}

async function createBranch() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = await vscode.window.showInputBox({
    prompt: t('enterBranchName'),
    placeHolder: t('enterBranchName'),
  });
  if (!branchName || !branchName.trim()) return;

  try {
    await execGit(['checkout', '-b', branchName.trim()], cwd);
    vscode.window.showInformationMessage(t('branchCreated', branchName.trim()));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execSwitch(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const isRemote = item.contextValue === 'remoteBranch';

  try {
    if (isRemote) {
      // origin/feature/x → feature/x 로컬 트래킹 브랜치 생성 후 전환
      const localName = branchName.replace(/^[^/]+\//, '');
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git switch -c ${localName} ${branchName}`) },
        () => execGit(['switch', '-c', localName, branchName], cwd)
      );
      vscode.window.showInformationMessage(t('switchSuccess', localName));
    } else {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git switch ${branchName}`) },
        () => execGit(['switch', branchName], cwd)
      );
      vscode.window.showInformationMessage(t('switchSuccess', branchName));
    }
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execRebaseMerge(item, action) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showWarningMessage(t('detachedHeadWarn'));
  }

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') {
    vscode.window.showWarningMessage(t('inProgressRebase'));
    return;
  }
  if (inProgress === 'merge') {
    vscode.window.showWarningMessage(t('inProgressMerge'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);
  const selectedBranch = item.branchName;

  const confirmMsg = action === 'rebase'
    ? t('confirmRebase', currentBranch, selectedBranch)
    : t('confirmMerge', currentBranch, selectedBranch);
  const detail = action === 'rebase'
    ? (isKo
      ? `현재 브랜치(${currentBranch})의 커밋들을 ${selectedBranch} 브랜치 위로 재배치합니다.\n커밋 히스토리가 깔끔해지지만, 기존 커밋 해시가 변경됩니다.`
      : `Replays commits from ${currentBranch} on top of ${selectedBranch}.\nCreates a linear history but changes existing commit hashes.`)
    : (isKo
      ? `${selectedBranch} 브랜치의 변경사항을 현재 브랜치(${currentBranch})에 합칩니다.\n머지 커밋이 생성되며, 양쪽 히스토리가 보존됩니다.`
      : `Integrates changes from ${selectedBranch} into ${currentBranch}.\nCreates a merge commit, preserving both branch histories.`);
  const actionLabel = action === 'rebase'
    ? t('rebaseOnto', selectedBranch)
    : t('mergeInto', currentBranch);
  const confirm = await vscode.window.showWarningMessage(
    confirmMsg, { modal: true, detail }, actionLabel, t('cancel')
  );
  if (confirm !== actionLabel) return;

  const gitArgs = action === 'rebase'
    ? ['rebase', selectedBranch]
    : ['merge', '--no-edit', selectedBranch];
  const gitCmd = `git ${gitArgs.join(' ')}`;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', gitCmd) },
      () => execGit(gitArgs, cwd)
    );
    try {
      const { stdout } = await execGitSilent(['rev-list', '--count', `${selectedBranch}..HEAD`], cwd);
      vscode.window.showInformationMessage(t('successWithCount', gitCmd, stdout.trim()));
    } catch {
      vscode.window.showInformationMessage(t('success', gitCmd));
    }
  } catch (err) {
    await handleGitError(err, action, cwd);
  }
}

async function execCherryPickCommit(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress) {
    const msgKey = inProgress === 'rebase' ? 'inProgressRebase'
      : inProgress === 'cherry-pick' ? 'inProgressCherryPick'
      : 'inProgressMerge';
    vscode.window.showWarningMessage(t(msgKey));
    return;
  }

  const hash = item.commitHash;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git cherry-pick ${hash.substring(0, 8)}`) },
      () => execGit(['cherry-pick', hash], cwd)
    );
    vscode.window.showInformationMessage(t('cherryPickSuccess', hash.substring(0, 8)));
  } catch (err) {
    await handleGitError(err, 'cherry-pick', cwd);
  }
}

async function execReset(item, mode) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const hash = item.commitHash;

  if (mode === '--hard') {
    const confirm = await vscode.window.showWarningMessage(
      t('confirmHardReset', hash.substring(0, 8)),
      { modal: false }, t('yes'), t('cancel')
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

async function copyHash(item) {
  await vscode.env.clipboard.writeText(item.commitHash);
  vscode.window.showInformationMessage(t('hashCopied', item.commitHash.substring(0, 8)));
}

async function openCommitFileDiff(hash, filePath, cwd) {
  try {
    const parentRef = `${hash}~1`;
    const beforeUri = vscode.Uri.parse(
      `gitreflow://show/${parentRef}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const afterUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const title = `${filePath} (${hash.substring(0, 8)})`;
    await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function openFileDiff(fileUri) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;

  const filePath = vscode.workspace.asRelativePath(fileUri, false);
  try {
    const { stdout } = await execGit(
      ['log', '-1', '--format=%H', '--', filePath], cwd
    );
    const hash = stdout.trim();
    if (!hash) {
      await vscode.commands.executeCommand('vscode.open', fileUri);
      return;
    }

    const commitUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const title = `${filePath} (${hash.substring(0, 8)} vs Working)`;
    await vscode.commands.executeCommand('vscode.diff', commitUri, fileUri, title);
  } catch {
    await vscode.commands.executeCommand('git.openChange', fileUri);
  }
}

async function viewDiff(item) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;

  const hash = item.commitHash;
  try {
    const { stdout } = await execGit(
      ['diff-tree', '--no-commit-id', '-r', '--name-only', hash], cwd
    );
    const files = stdout.trim().split('\n').filter(Boolean);
    if (files.length === 0) {
      vscode.window.showInformationMessage(t('noDiffFiles'));
      return;
    }

    const fileItems = files.map(f => ({ label: f }));
    const selectedFile = await vscode.window.showQuickPick(fileItems, {
      placeHolder: t('selectFile'),
    });
    if (!selectedFile) return;

    const commitUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${selectedFile.label}?cwd=${encodeURIComponent(cwd)}`
    );
    const workingUri = vscode.Uri.file(path.join(cwd, selectedFile.label));
    const title = `${selectedFile.label} (${hash.substring(0, 8)} vs Working)`;
    await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function abortOperation() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (!inProgress) return;

  const abortCmd = inProgress === 'rebase' ? ['rebase', '--abort']
    : inProgress === 'cherry-pick' ? ['cherry-pick', '--abort']
    : ['merge', '--abort'];
  const label = inProgress === 'rebase' ? t('abortRebase')
    : inProgress === 'cherry-pick' ? t('abortCherryPick')
    : t('abortMerge');

  const confirm = await vscode.window.showWarningMessage(
    label + '?', { modal: false }, t('yes'), t('cancel')
  );
  if (confirm !== t('yes')) return;

  try {
    await execGit(abortCmd, cwd);
    vscode.window.showInformationMessage(
      isKo ? '작업이 취소되었습니다.' : 'Operation aborted.'
    );
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function continueOperation() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (!inProgress) {
    vscode.window.showInformationMessage(
      isKo ? '진행 중인 작업이 없습니다.' : 'No operation in progress.'
    );
    return;
  }

  // 충돌 파일이 남아있는지 확인
  const conflictFiles = await getConflictedFiles(cwd);
  if (conflictFiles.length > 0) {
    vscode.window.showWarningMessage(
      isKo ? `아직 해결되지 않은 충돌 파일이 ${conflictFiles.length}개 있습니다.`
        : `${conflictFiles.length} conflicted file(s) remaining.`
    );
    return;
  }

  try {
    // 변경사항 stage
    await execGit(['add', '.'], cwd);

    const continueCmd = inProgress === 'rebase' ? ['rebase', '--continue']
      : inProgress === 'cherry-pick' ? ['cherry-pick', '--continue']
      : ['commit', '--no-edit'];
    await execGit(continueCmd, cwd, { env: { ...process.env, GIT_EDITOR: 'true' } });
    vscode.window.showInformationMessage(
      isKo ? '작업이 완료되었습니다.' : 'Operation completed.'
    );
  } catch (err) {
    const msg = err.stderr || err.stdout || err.message || String(err);
    if (isConflict(msg)) {
      await handleGitError(err, inProgress, cwd);
    } else {
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
  }
}

async function execSquashCommits(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const hash = item.commitHash;

  // 선택한 커밋부터 HEAD까지 커밋 목록 조회
  const { stdout: logOut } = await execGitSilent(
    ['log', '--format=%H %s', `${hash}~1..HEAD`], cwd
  );
  const commits = logOut.trim().split('\n').filter(Boolean);
  if (commits.length < 2) {
    vscode.window.showWarningMessage(
      isKo ? '합칠 커밋이 2개 이상이어야 합니다.' : 'Need at least 2 commits to squash.'
    );
    return;
  }

  // 커밋 메시지 목록을 기본값으로 제공
  const messages = commits.map((line) => line.substring(line.indexOf(' ') + 1));
  const defaultMsg = messages.join('\n');

  const userMsg = await vscode.window.showInputBox({
    title: isKo ? '커밋 합치기' : 'Squash Commits',
    prompt: isKo
      ? `${commits.length}개 커밋을 합칩니다. 커밋 메시지를 입력하세요.`
      : `Squashing ${commits.length} commits. Enter commit message.`,
    value: defaultMsg,
    ignoreFocusOut: true,
  });
  if (userMsg === undefined) return;

  // 커밋 시간 옵션
  const timeLabel = isKo
    ? ['원래 커밋 시간 유지', '현재 시간 사용']
    : ['Keep original commit time', 'Use current time'];
  const timeChoice = await vscode.window.showQuickPick(
    [
      { label: timeLabel[0], value: 'original' },
      { label: timeLabel[1], value: 'now' },
    ],
    {
      title: isKo ? '커밋 시간 선택' : 'Commit time',
      placeHolder: isKo ? '합쳐진 커밋의 시간을 선택하세요' : 'Choose the time for the squashed commit',
    }
  );
  if (!timeChoice) return;

  // unstaged 변경사항이 있으면 자동 stash
  let stashed = false;
  try {
    const { stdout } = await execGitSilent(['diff', '--stat'], cwd);
    const { stdout: stagedOut } = await execGitSilent(['diff', '--cached', '--stat'], cwd);
    if (stdout.trim() || stagedOut.trim()) {
      await execGit(['stash', 'push', '-m', 'auto-stash before squash'], cwd);
      stashed = true;
    }
  } catch { /* ignore */ }

  try {
    // 원래 커밋의 author date 조회 (가장 오래된 커밋 기준)
    const { stdout: dateOut } = await execGitSilent(
      ['log', '-1', '--format=%aI', hash], cwd
    );
    const originalDate = dateOut.trim();

    // soft reset으로 커밋 내용은 유지하면서 커밋 이력만 제거
    await execGit(['reset', '--soft', `${hash}~1`], cwd);

    // 커밋 생성
    const commitArgs = ['commit', '-m', userMsg];
    const env = {};
    if (timeChoice.value === 'original') {
      env.GIT_AUTHOR_DATE = originalDate;
      env.GIT_COMMITTER_DATE = originalDate;
    }
    await execGit(commitArgs, cwd, { env: { ...process.env, ...env } });

    vscode.window.showInformationMessage(
      isKo
        ? `${commits.length}개 커밋이 합쳐졌습니다.`
        : `${commits.length} commits squashed.`
    );
  } catch (err) {
    const errMsg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(
      isKo ? `커밋 합치기 실패: ${errMsg}` : `Squash failed: ${errMsg}`
    );
  } finally {
    if (stashed) {
      try { await execGit(['stash', 'pop'], cwd); } catch { /* ignore */ }
    }
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
      { modal: false }, t('yes'), t('cancel')
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

// ─── Command Palette Handlers (backward compat) ────────────────────

async function rebaseMerge(remote) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showWarningMessage(t('detachedHeadWarn'));
  }

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') { vscode.window.showWarningMessage(t('inProgressRebase')); return; }
  if (inProgress === 'merge') { vscode.window.showWarningMessage(t('inProgressMerge')); return; }

  if (remote) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('fetchingRemotes') },
      () => fetchAll(cwd)
    );
  }

  const currentBranch = await getCurrentBranch(cwd);
  const branches = remote
    ? await getRemoteBranches(cwd)
    : (await getLocalBranches(cwd)).filter(b => b.name !== currentBranch);

  if (branches.length === 0) { vscode.window.showInformationMessage(t('noBranches')); return; }

  const selectedBranch = await showBranchPicker(branches, currentBranch);
  if (!selectedBranch) return;

  const action = await showActionPicker(selectedBranch);
  if (!action) return;

  const confirmMsg = action === 'rebase'
    ? t('confirmRebase', currentBranch, selectedBranch)
    : t('confirmMerge', currentBranch, selectedBranch);
  const detail = action === 'rebase'
    ? (isKo
      ? `현재 브랜치(${currentBranch})의 커밋들을 ${selectedBranch} 브랜치 위로 재배치합니다.\n커밋 히스토리가 깔끔해지지만, 기존 커밋 해시가 변경됩니다.`
      : `Replays commits from ${currentBranch} on top of ${selectedBranch}.\nCreates a linear history but changes existing commit hashes.`)
    : (isKo
      ? `${selectedBranch} 브랜치의 변경사항을 현재 브랜치(${currentBranch})에 합칩니다.\n머지 커밋이 생성되며, 양쪽 히스토리가 보존됩니다.`
      : `Integrates changes from ${selectedBranch} into ${currentBranch}.\nCreates a merge commit, preserving both branch histories.`);
  const actionLabel = action === 'rebase'
    ? t('rebaseOnto', selectedBranch)
    : t('mergeInto', currentBranch);
  const confirm = await vscode.window.showWarningMessage(
    confirmMsg, { modal: true, detail }, actionLabel, t('cancel')
  );
  if (confirm !== actionLabel) return;

  const gitArgs = action === 'rebase'
    ? ['rebase', selectedBranch]
    : ['merge', '--no-edit', selectedBranch];
  const gitCmd = `git ${gitArgs.join(' ')}`;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', gitCmd) },
      () => execGit(gitArgs, cwd)
    );
    try {
      const { stdout } = await execGitSilent(['rev-list', '--count', `${selectedBranch}..HEAD`], cwd);
      vscode.window.showInformationMessage(t('successWithCount', gitCmd, stdout.trim()));
    } catch {
      vscode.window.showInformationMessage(t('success', gitCmd));
    }
  } catch (err) {
    await handleGitError(err, action, cwd);
  }
}

async function pullBranch() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) { vscode.window.showErrorMessage(t('detachedHead')); return; }

  const currentBranch = await getCurrentBranch(cwd);
  const branches = await getLocalBranches(cwd);
  if (branches.length === 0) { vscode.window.showInformationMessage(t('noBranches')); return; }

  const selectedBranch = await showBranchPicker(branches, currentBranch);
  if (!selectedBranch) return;

  const pullAction = await showPullActionPicker();
  if (!pullAction) return;

  if (selectedBranch === currentBranch) {
    const pullArgs = pullAction === 'pull-rebase' ? ['pull', '--rebase'] : ['pull'];
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${pullArgs.join(' ')}`) },
        () => execGit(pullArgs, cwd)
      );
      vscode.window.showInformationMessage(t('pullSuccess', selectedBranch));
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
    return;
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch origin ${selectedBranch}`) },
      () => execGit(['fetch', 'origin', `${selectedBranch}:${selectedBranch}`], cwd, { timeout: 30000 })
    );
    vscode.window.showInformationMessage(t('pullSuccess', selectedBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    if (/non-fast-forward|rejected/i.test(msg)) {
      vscode.window.showWarningMessage(t('branchDiverged', selectedBranch));
    } else {
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
  }
}

async function pushBranch() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) { vscode.window.showErrorMessage(t('detachedHeadPush')); return; }

  const currentBranch = await getCurrentBranch(cwd);

  const pushItems = [
    { label: `$(cloud-upload) ${t('push')}`, value: 'push' },
    { label: `$(warning) ${t('pushForce')}`, value: 'force' },
  ];
  const pushAction = await vscode.window.showQuickPick(pushItems, { placeHolder: t('selectAction') });
  if (!pushAction) return;

  if (pushAction.value === 'force') {
    const confirm = await vscode.window.showWarningMessage(
      t('forcePushConfirm', currentBranch), { modal: false }, t('yes'), t('cancel')
    );
    if (confirm !== t('yes')) return;
  }

  let hasUpstream = true;
  try {
    await execGitSilent(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`], cwd);
  } catch { hasUpstream = false; }

  const pushArgs = ['push'];
  if (pushAction.value === 'force') pushArgs.push('--force');
  if (!hasUpstream) pushArgs.push('--set-upstream', 'origin', currentBranch);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${pushArgs.join(' ')}`) },
      () => execGit(pushArgs, cwd)
    );
    vscode.window.showInformationMessage(t('pushSuccess', currentBranch));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function commitChanges() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const { stdout: statusOut } = await execGitSilent(['status', '--porcelain'], cwd);
  if (!statusOut.trim()) { vscode.window.showInformationMessage(t('noChanges')); return; }

  const lines = statusOut.trimEnd().split('\n');
  const fileItems = lines.map(line => {
    const indexStatus = line[0];
    const workStatus = line[1];
    const filePath = line.substring(3);
    const isStaged = indexStatus !== ' ' && indexStatus !== '?';
    const statusIcons = { M: '$(edit)', A: '$(add)', D: '$(trash)', '?': '$(question)', R: '$(arrow-right)' };
    const statusCode = isStaged ? indexStatus : (workStatus === '?' ? '?' : workStatus);
    const icon = statusIcons[statusCode] || '$(file)';
    return { label: `${icon} ${filePath}`, description: isStaged ? 'staged' : 'unstaged', filePath, picked: isStaged };
  });

  const selected = await vscode.window.showQuickPick(fileItems, { placeHolder: t('selectFiles'), canPickMany: true });
  if (!selected || selected.length === 0) return;

  const pastMessages = await getCommitLog(cwd, { count: 20 });
  const msgItems = [
    { label: t('newMessage'), value: '__new__' },
    ...pastMessages.map(c => ({ label: c.message, description: `${c.author}  ${c.date}`, value: c.message })),
  ];
  const msgChoice = await vscode.window.showQuickPick(msgItems, { placeHolder: t('selectCommitMsg') });
  if (!msgChoice) return;

  let commitMessage;
  if (msgChoice.value === '__new__') {
    commitMessage = await vscode.window.showInputBox({ prompt: t('enterCommitMsg'), placeHolder: t('enterCommitMsg') });
    if (!commitMessage) return;
  } else {
    commitMessage = msgChoice.value;
  }

  try {
    try { await execGit(['reset', 'HEAD'], cwd); } catch { /* initial commit */ }
    await execGit(['add', '--', ...selected.map(s => s.filePath)], cwd);
    await execGit(['commit', '-m', commitMessage], cwd);
    vscode.window.showInformationMessage(t('commitSuccess', commitMessage));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function resetCommit() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const modeItems = [
    { label: `$(history) ${t('resetSoft')}`, value: '--soft' },
    { label: `$(warning) ${t('resetHard')}`, value: '--hard' },
  ];
  const modeChoice = await vscode.window.showQuickPick(modeItems, { placeHolder: t('selectResetMode') });
  if (!modeChoice) return;

  const commit = await showCommitPicker(cwd, { title: t('selectCommit') });
  if (!commit) return;

  if (modeChoice.value === '--hard') {
    const confirm = await vscode.window.showWarningMessage(
      t('confirmHardReset', commit.hash.substring(0, 8)), { modal: false }, t('yes'), t('cancel')
    );
    if (confirm !== t('yes')) return;
  }

  try {
    await execGit(['reset', modeChoice.value, commit.hash], cwd);
    vscode.window.showInformationMessage(t('resetSuccess', commit.hash.substring(0, 8)));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function cherryPick() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') { vscode.window.showWarningMessage(t('inProgressRebase')); return; }
  if (inProgress === 'merge') { vscode.window.showWarningMessage(t('inProgressMerge')); return; }
  if (inProgress === 'cherry-pick') { vscode.window.showWarningMessage(t('inProgressCherryPick')); return; }

  const currentBranch = await getCurrentBranch(cwd);
  const branches = (await getLocalBranches(cwd)).filter(b => b.name !== currentBranch);
  if (branches.length === 0) { vscode.window.showInformationMessage(t('noBranches')); return; }

  const selectedBranch = await showBranchPicker(branches, currentBranch);
  if (!selectedBranch) return;

  const commit = await showCommitPicker(cwd, { branch: selectedBranch, title: t('selectCommit') });
  if (!commit) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git cherry-pick ${commit.hash.substring(0, 8)}`) },
      () => execGit(['cherry-pick', commit.hash], cwd)
    );
    vscode.window.showInformationMessage(t('cherryPickSuccess', commit.hash.substring(0, 8)));
  } catch (err) {
    await handleGitError(err, 'cherry-pick', cwd);
  }
}

async function showHistory() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const commit = await showCommitPicker(cwd, { title: t('historyTitle') });
  if (!commit) return;

  const actionItems = [
    { label: t('copyHash'), value: 'copy' },
    { label: t('viewDiff'), value: 'diff' },
    { label: t('cherryPickAction'), value: 'cherry-pick' },
    { label: t('resetToHere'), value: 'reset' },
  ];
  const action = await vscode.window.showQuickPick(actionItems, { placeHolder: t('selectHistoryAction') });
  if (!action) return;

  if (action.value === 'copy') {
    await vscode.env.clipboard.writeText(commit.hash);
    vscode.window.showInformationMessage(t('hashCopied', commit.hash.substring(0, 8)));
    return;
  }

  if (action.value === 'diff') {
    try {
      const { stdout } = await execGit(['diff-tree', '--no-commit-id', '-r', '--name-only', commit.hash], cwd);
      const files = stdout.trim().split('\n').filter(Boolean);
      if (files.length === 0) { vscode.window.showInformationMessage(t('noDiffFiles')); return; }

      const fileItems = files.map(f => ({ label: f }));
      const selectedFile = await vscode.window.showQuickPick(fileItems, { placeHolder: t('selectFile') });
      if (!selectedFile) return;

      const commitUri = vscode.Uri.parse(
        `gitreflow://show/${commit.hash}/${selectedFile.label}?cwd=${encodeURIComponent(cwd)}`
      );
      const workingUri = vscode.Uri.file(path.join(cwd, selectedFile.label));
      await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri,
        `${selectedFile.label} (${commit.hash.substring(0, 8)} vs Working)`);
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
    return;
  }

  if (action.value === 'cherry-pick') {
    const inProgress = await hasInProgressOperation(cwd);
    if (inProgress) {
      const msgKey = inProgress === 'rebase' ? 'inProgressRebase'
        : inProgress === 'cherry-pick' ? 'inProgressCherryPick' : 'inProgressMerge';
      vscode.window.showWarningMessage(t(msgKey));
      return;
    }
    try {
      await execGit(['cherry-pick', commit.hash], cwd);
      vscode.window.showInformationMessage(t('cherryPickSuccess', commit.hash.substring(0, 8)));
    } catch (err) {
      await handleGitError(err, 'cherry-pick', cwd);
    }
    return;
  }

  if (action.value === 'reset') {
    const modeItems = [
      { label: `$(history) ${t('resetSoft')}`, value: '--soft' },
      { label: `$(warning) ${t('resetHard')}`, value: '--hard' },
    ];
    const modeChoice = await vscode.window.showQuickPick(modeItems, { placeHolder: t('selectResetMode') });
    if (!modeChoice) return;

    if (modeChoice.value === '--hard') {
      const confirm = await vscode.window.showWarningMessage(
        t('confirmHardReset', commit.hash.substring(0, 8)), { modal: false }, t('yes'), t('cancel')
      );
      if (confirm !== t('yes')) return;
    }

    try {
      await execGit(['reset', modeChoice.value, commit.hash], cwd);
      vscode.window.showInformationMessage(t('resetSuccess', commit.hash.substring(0, 8)));
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      vscode.window.showErrorMessage(t('failed', msg.trim()));
    }
  }
}

// ─── Sidebar TreeView ───────────────────────────────────────────────

class GitQuickPickTreeProvider {
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
  // 섹션 펼침 상태 추적
  _expandedSections = new Set();
  _remoteFetchRequested = true; // 최초 펼칠 때 fetch

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
      const descParts = [];
      if (this._branchName) descParts.push(this._branchName);
      if (this._changeCount > 0) descParts.push(t('changes', this._changeCount));
      this._commitSectionItem.description = descParts.join(' · ');
      this.refresh(this._commitSectionItem);
    }
  }

  getTreeItem(element) { return element; }

  async getChildren(element) {
    const cwd = getWorkspaceCwd();
    if (!element) return this._getRootItems();
    if (!cwd || !await isGitRepo(cwd)) return [];

    switch (element.contextValue) {
      case 'commitSection': return this._getChangedFileItems(cwd, null);
      case 'changedDir': return this._getChangedFileItems(cwd, element.dirPath);
      case 'historySection': return this._getHistoryItems(cwd);
      case 'historyCommit': return this._getCommitFileItems(cwd, element);
      case 'localBranchSection': return this._getLocalBranchItems(cwd);
      case 'remoteBranchSection': return this._getRemoteBranchItems(cwd);
      case 'localBranch':
      case 'localBranchCurrent': return this._getBranchHistoryItems(cwd, element);
      case 'remoteBranch': return this._getBranchHistoryItems(cwd, element);
      case 'branchHistoryCommit': return this._getCommitFileItems(cwd, element);
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
    const descParts = [];
    if (this._branchName) descParts.push(this._branchName);
    if (this._changeCount > 0) descParts.push(t('changes', this._changeCount));
    commitItem.description = descParts.join(' · ');
    this._commitSectionItem = commitItem;
    items.push(commitItem);

    // 히스토리
    const historyExpanded = this._expandedSections.has('historySection');
    const historyItem = new vscode.TreeItem(t('sectionHistory'),
      historyExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    historyItem.iconPath = new vscode.ThemeIcon('history');
    historyItem.contextValue = 'historySection';
    items.push(historyItem);

    // 로컬 브랜치
    const localExpanded = this._expandedSections.has('localBranchSection');
    const localItem = new vscode.TreeItem(t('sectionLocalBranch'),
      localExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    localItem.iconPath = new vscode.ThemeIcon('git-branch');
    localItem.contextValue = 'localBranchSection';
    items.push(localItem);

    // 원격 브랜치
    const remoteExpanded = this._expandedSections.has('remoteBranchSection');
    const remoteItem = new vscode.TreeItem(t('sectionRemoteBranch'),
      remoteExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    remoteItem.iconPath = new vscode.ThemeIcon('cloud');
    remoteItem.contextValue = 'remoteBranchSection';
    items.push(remoteItem);

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
    item.tooltip = `${f.filePath} [${f.statusCode}] ${f.isStaged ? 'staged' : 'unstaged'}`;

    if (f.statusCode === '?') {
      item.contextValue = 'fileUntracked';
    } else if (f.statusCode === 'M') {
      item.contextValue = 'fileModified';
    } else if (f.statusCode === 'D') {
      item.contextValue = 'fileDeleted';
    } else {
      item.contextValue = 'fileOther';
    }

    if (f.statusCode === 'M') {
      item.command = { command: 'gitReflow.dblClick', title: 'Diff',
        arguments: ['gitReflow.openFileDiff', fileUri] };
    } else if (f.statusCode === 'A') {
      item.command = { command: 'gitReflow.dblClick', title: 'Open',
        arguments: ['vscode.open', fileUri] };
    }

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

  async _getHistoryItems(cwd) {
    const commits = await getCommitLog(cwd);
    return commits.map(c => {
      const item = new vscode.TreeItem(c.message, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${c.author}  ${c.date}  ${c.hash.substring(0, 7)}`;
      item.iconPath = new vscode.ThemeIcon('git-commit');
      item.contextValue = 'historyCommit';
      item.commitHash = c.hash;
      return item;
    });
  }

  async _getCommitFileItems(cwd, element) {
    const hash = element.commitHash;
    try {
      const { stdout } = await execGit(
        ['diff-tree', '--no-commit-id', '-r', '--name-only', hash], cwd
      );
      const files = stdout.trim().split('\n').filter(Boolean);
      return files.map(f => {
        const item = new vscode.TreeItem(
          path.basename(f),
          vscode.TreeItemCollapsibleState.None
        );
        item.description = path.dirname(f) === '.' ? '' : path.dirname(f);
        item.iconPath = vscode.ThemeIcon.File;
        item.contextValue = 'historyFile';
        item.tooltip = f;
        item.command = { command: 'gitReflow.dblClick', title: 'Diff',
          arguments: ['gitReflow.openCommitFileDiff', hash, f, cwd] };
        return item;
      });
    } catch {
      return [];
    }
  }

  async _getLocalBranchItems(cwd) {
    const currentBranch = await getCurrentBranch(cwd);
    const branches = await getLocalBranches(cwd);
    return branches.map(b => {
      const isCurrent = b.name === currentBranch;
      const label = isCurrent ? `${b.name} ${t('current')}` : b.name;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(isCurrent ? 'check' : 'git-branch');
      item.description = b.description;
      item.contextValue = isCurrent ? 'localBranchCurrent' : 'localBranch';
      item.branchName = b.name;
      return item;
    });
  }

  async _getRemoteBranchItems(cwd) {
    // fetch는 수동 새로고침(refreshView) 시에만 실행
    if (this._remoteFetchRequested) {
      this._remoteFetchRequested = false;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('fetchingRemotes') },
        () => fetchAll(cwd)
      );
    }
    const branches = await getRemoteBranches(cwd);
    return branches.map(b => {
      const item = new vscode.TreeItem(b.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('cloud');
      item.description = b.description;
      item.contextValue = 'remoteBranch';
      item.branchName = b.name;
      return item;
    });
  }

  async _getBranchHistoryItems(cwd, parentItem) {
    const commits = await getCommitLog(cwd, { branch: parentItem.branchName });
    return commits.map(c => {
      const item = new vscode.TreeItem(c.message, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${c.author}  ${c.date}  ${c.hash.substring(0, 7)}`;
      item.iconPath = new vscode.ThemeIcon('git-commit');
      item.contextValue = 'branchHistoryCommit';
      item.commitHash = c.hash;
      return item;
    });
  }
}

// ─── Activation ─────────────────────────────────────────────────────

function activate(context) {
  // Output Channel 생성
  outputChannel = vscode.window.createOutputChannel('Git QuickPick');
  context.subscriptions.push(outputChannel);

  // Git content provider 등록 (history diff용)
  const gitProvider = new GitContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('gitreflow', gitProvider)
  );

  // 커밋 메시지 WebviewView 등록
  const commitInputProvider = new CommitInputViewProvider(context.globalState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('gitQuickPickCommitInput', commitInputProvider)
  );

  // Sidebar TreeView 등록
  const treeProvider = new GitQuickPickTreeProvider();
  const treeView = vscode.window.createTreeView('gitQuickPickView', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
    manageCheckboxStateManually: true,
  });
  context.subscriptions.push(treeView);

  // Ctrl+Enter / 웹뷰 커밋 버튼으로 커밋
  context.subscriptions.push(
    commitInputProvider.onDidCommit(async () => {
      await execCommit(treeProvider, commitInputProvider);
      await fullRefresh();
    })
  );

  // 타이틀에 브랜치 정보 표시
  function updateTitleDescription() {
    if (treeProvider._branchName) {
      const desc = treeProvider._changeCount > 0
        ? `${treeProvider._branchName} · ${t('changes', treeProvider._changeCount)}`
        : treeProvider._branchName;
      treeView.description = desc;
    } else {
      treeView.description = '';
    }
  }

  // updateStatus 후 타이틀 + 컨텍스트 갱신
  const origUpdateStatus = treeProvider.updateStatus.bind(treeProvider);
  function updateCheckedFilesContext() {
    const hasChecked = [...treeProvider._checkedFiles.values()].some(v => v);
    vscode.commands.executeCommand('setContext', 'gitReflow.hasCheckedFiles', hasChecked);
  }

  treeProvider.updateStatus = async function () {
    await origUpdateStatus();
    updateTitleDescription();
    vscode.commands.executeCommand('setContext', 'gitReflow.hasChanges', treeProvider._changeCount > 0);
    updateCheckedFilesContext();
  };
  treeProvider.updateStatus();

  // 패널이 다시 보일 때 자동 새로고침
  context.subscriptions.push(
    treeView.onDidChangeVisibility(e => {
      if (e.visible) treeProvider.updateStatus();
    })
  );

  // 섹션 펼침/접힘 상태 추적 + 펼칠 때 새로고침
  context.subscriptions.push(
    treeView.onDidExpandElement(e => {
      const ctx = e.element.contextValue;
      treeProvider._expandedSections.add(ctx);
      if (ctx === 'commitSection') {
        treeProvider.updateStatus();
      } else if (['historySection', 'localBranchSection', 'remoteBranchSection'].includes(ctx)) {
        treeProvider.refresh(e.element);
      }
    })
  );
  context.subscriptions.push(
    treeView.onDidCollapseElement(e => {
      treeProvider._expandedSections.delete(e.element.contextValue);
    })
  );

  // 체크박스 상태 변경 처리
  context.subscriptions.push(
    treeView.onDidChangeCheckboxState(e => {
      for (const [item, state] of e.items) {
        const checked = state === vscode.TreeItemCheckboxState.Checked;
        if (item.contextValue === 'selectAll') {
          for (const key of treeProvider._checkedFiles.keys()) {
            treeProvider._checkedFiles.set(key, checked);
          }
          treeProvider.refresh(treeProvider._commitSectionItem);
        } else if (item.filePath) {
          treeProvider._checkedFiles.set(item.filePath, checked);
        }
      }
      updateCheckedFilesContext();
    })
  );

  // 파일 저장 시 상태 갱신
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => treeProvider.updateStatus())
  );

  // 전체 트리 갱신 (상태 + UI + 컨텍스트)
  async function fullRefresh() {
    await treeProvider._fetchStatus();
    treeProvider._commitSectionItem = null;
    treeProvider.refresh();
    updateTitleDescription();
    vscode.commands.executeCommand('setContext', 'gitReflow.hasChanges', treeProvider._changeCount > 0);
    updateCheckedFilesContext();
  }
  _fullRefreshFn = fullRefresh;

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
    'gitReflow.execCommit': withRefresh(() => execCommit(treeProvider, commitInputProvider)),
    'gitReflow.toggleSelectAll': () => {
      const allChecked = [...treeProvider._checkedFiles.values()].length > 0
        && [...treeProvider._checkedFiles.values()].every(v => v);
      for (const key of treeProvider._checkedFiles.keys()) {
        treeProvider._checkedFiles.set(key, !allChecked);
      }
      treeProvider.refresh(treeProvider._commitSectionItem);
    },
    'gitReflow.toggleFileView': () => {
      treeProvider._fileViewMode = treeProvider._fileViewMode === 'list' ? 'tree' : 'list';
      treeProvider.refresh(treeProvider._commitSectionItem);
    },
    'gitReflow.stageFile': withRefresh((item) => execStageFile(item)),
    'gitReflow.rollbackFile': withRefresh((item) => execRollbackFile(item)),
    'gitReflow.deleteFile': withRefresh((item) => execDeleteFile(item)),
    // 타이틀 바 명령
    'gitReflow.execPush': withRefresh(() => execPush(false)),
    'gitReflow.execForcePush': withRefresh(() => execPush(true)),
    'gitReflow.execPull': withRefresh(() => execPull()),
    'gitReflow.refreshView': async () => {
      treeProvider._remoteFetchRequested = true;
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
    'gitReflow.openCommitFileDiff': (hash, filePath, cwd) => openCommitFileDiff(hash, filePath, cwd),
    'gitReflow.execInteractiveRebase': withRefresh((item) => execSquashCommits(item)),
    'gitReflow.abortOperation': withRefresh(() => abortOperation()),
    'gitReflow.continueOperation': withRefresh(() => continueOperation()),
    'gitReflow.copyHash': (item) => copyHash(item),
    'gitReflow.viewDiff': (item) => viewDiff(item),
    'gitReflow.resetToHere': withRefresh((item) => resetToHere(item)),
    'gitReflow.createBranch': withRefresh(() => createBranch()),
    'gitReflow.execBranchPull': withRefresh((item) => execBranchPull(item)),
    'gitReflow.execForceBranchPull': withRefresh((item) => execForceBranchPull(item)),
    // Command Palette 명령 (하위 호환)
    'gitReflow.rebasemergeLocal': withRefresh(() => rebaseMerge(false)),
    'gitReflow.rebasemergeRemote': withRefresh(() => rebaseMerge(true)),
    'gitReflow.pullBranch': withRefresh(pullBranch),
    'gitReflow.push': withRefresh(pushBranch),
    'gitReflow.commit': withRefresh(commitChanges),
    'gitReflow.reset': withRefresh(resetCommit),
    'gitReflow.cherryPick': withRefresh(cherryPick),
    'gitReflow.history': withRefresh(showHistory),
  };

  for (const [id, fn] of Object.entries(cmds)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, fn)
    );
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
