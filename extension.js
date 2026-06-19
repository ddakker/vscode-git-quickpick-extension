'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);

// 순수 헬퍼 — vscode 의존 없는 함수들은 lib/git-helpers.js 로 분리
const {
  buildGitEnv,
  isHttpRemote,
  isAuthError,
  parseAuthTargetFromError,
  isConflict,
  isUnmergedStatus,
  formatCommitDate,
  buildRebaseBackupName,
  selectStaleBackups,
  parseStashList,
  parseNameStatus,
} = require('./lib/git-helpers');

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
  fetchingBranch:   ['{0} 브랜치 가져오는 중...', 'Fetching branch {0}...'],
  notFetched:       ['(미페치)', '(not fetched)'],
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
  backupCreated: [
    '복구용 백업 브랜치 생성: {0}',
    'Backup branch created: {0}'
  ],
  backupFailed: [
    '백업 브랜치 생성 실패: {0} (rebase는 계속 진행합니다)',
    'Failed to create backup branch: {0} (continuing rebase)'
  ],
  backupReused: [
    '동일한 커밋의 백업 브랜치가 이미 있어 재사용합니다: {0}',
    'Reusing existing backup branch at the same commit: {0}'
  ],
  cleanupBackupsNone: [
    '정리할 오래된 백업 브랜치가 없습니다.',
    'No old backup branches to clean up.'
  ],
  confirmCleanupBackups: [
    '오래된 백업 브랜치 {0}개를 삭제합니다. 계속할까요?',
    'Delete {0} old backup branch(es). Continue?'
  ],
  cleanupBackupsDetail: [
    '삭제 대상:\n{0}',
    'To be deleted:\n{0}'
  ],
  cleanupBackupsDone: [
    '백업 브랜치 {0}개를 삭제했습니다.',
    'Deleted {0} backup branch(es).'
  ],
  cleanupBackupsPartial: [
    '백업 브랜치 {0}개 삭제, {1}개 실패.',
    'Deleted {0} backup branch(es), {1} failed.'
  ],
  rebaseBackupNote: [
    '\n\nrebase 전 복구용 백업 브랜치(backup/...)가 자동 생성됩니다.',
    '\n\nA backup branch (backup/...) is created automatically before rebasing.'
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
  // ─── Modify/Delete conflict ────────────────────────────
  modifyDeleteTitle: [
    '충돌: {0} (한 쪽에서 삭제, 다른 쪽에서 수정)',
    'Conflict: {0} (deleted on one side, modified on the other)'
  ],
  deletedByIncoming: [
    '이 커밋(incoming)에서 삭제되었고, 현재 브랜치(HEAD)에서는 수정되었습니다.',
    'Deleted in the incoming commit, modified in the current branch (HEAD).'
  ],
  deletedByCurrent: [
    '현재 브랜치(HEAD)에서 삭제되었고, 이 커밋(incoming)에서는 수정되었습니다.',
    'Deleted in the current branch (HEAD), modified in the incoming commit.'
  ],
  keepDeletion:       ['삭제 유지', 'Keep deletion'],
  keepFile:           ['파일 유지', 'Keep file'],
  openFileToReview:   ['파일 열어보기', 'Open file to review'],
  modifyDeleteResolvedDeleted: [
    '{0} 삭제로 해결했습니다.',
    '{0} resolved as deleted.'
  ],
  modifyDeleteResolvedKept: [
    '{0} 파일 유지로 해결했습니다.',
    '{0} resolved as kept.'
  ],
  // ─── Conflict marker restore ───────────────────────────
  conflictRestoreTitle: [
    '{0}에 충돌 마커가 없습니다. 원래 충돌 상태로 복원할까요?',
    '{0} has no conflict markers. Restore the original conflict?'
  ],
  conflictRestoreDetail: [
    '머지 에디터에서 해결한 내용이 있다면 복원 시 사라질 수 있습니다.',
    'Any work resolved in the merge editor may be lost when restoring.'
  ],
  conflictRestore:    ['충돌 마커로 복원', 'Restore conflict markers'],
  conflictOpenAsIs:   ['현재 내용 그대로 열기', 'Open current content'],
  // ─── Push ──────────────────────────────────────────────
  push:               ['Push', 'Push'],
  pushForce:          ['Force Push', 'Force Push'],
  pushSuccess:        ['{0} 브랜치 푸시 완료', 'Pushed branch {0}'],
  forcePushConfirm:   ['{0} 브랜치를 Force Push합니까? 원격 히스토리가 덮어씌워집니다.', 'Force push {0}? This will overwrite remote history.'],
  forcePullConfirm:   ['{0} 브랜치를 Force Pull합니까? 로컬 변경사항과 커밋이 원격 내용으로 덮어써집니다.', 'Force pull {0}? Local changes and commits will be overwritten by the remote.'],
  detachedHeadPush:   ['Detached HEAD 상태입니다. push를 실행할 수 없습니다.', 'Cannot push in detached HEAD state.'],
  checkingRemote:     ['원격 변경사항 확인 중...', 'Checking remote changes...'],
  remoteHasCommits:   [
    '원격에 로컬에 없는 커밋 {0}개가 있습니다.\n취소하고 rebase(onto) 하시겠습니까?',
    'The remote has {0} commit(s) not in your local branch.\nCancel and rebase (onto)?'
  ],
  remoteHasCommitsDetail: [
    '현재 브랜치의 커밋들을 원격(upstream) 위로 재배치합니다.',
    'Replays your commits on top of the remote (upstream).'
  ],
  cancelAndRebase:    ['취소하고 rebase(onto)', 'Cancel & rebase (onto)'],
  rebaseThenPush:     ['rebase(onto) 완료 후 push', 'Rebase (onto) then push'],
  // ─── Commit ────────────────────────────────────────────
  selectFiles:        ['커밋할 파일을 선택하세요', 'Select files to commit'],
  newMessage:         ['✏️ 새 메시지 입력', '✏️ Enter new message'],
  noChanges:          ['변경된 파일이 없습니다.', 'No changed files.'],
  fileNotInWorkspace: [
    '{0} 파일이 현재 작업 폴더에 없습니다(삭제됨). 변경 내용은 diff로 확인하세요.',
    '{0} no longer exists in the workspace (deleted). View its changes via diff.'
  ],
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
  copyMessage:        ['📋 메시지 복사', '📋 Copy message'],
  tipDate:            ['날짜', 'Date'],
  tipAuthor:          ['작성자', 'Author'],
  tipHash:            ['해시', 'Hash'],
  tipMessage:         ['메시지', 'Message'],
  viewDiff:           ['📄 diff 보기', '📄 View diff'],
  local:              ['로컬', 'Local'],
  cherryPickAction:   ['🍒 체리픽', '🍒 Cherry pick'],
  resetToHere:        ['⏪ 여기로 리셋', '⏪ Reset to here'],
  hashCopied:         ['해시가 클립보드에 복사되었습니다: {0}', 'Hash copied to clipboard: {0}'],
  messageCopied:      ['메시지가 클립보드에 복사되었습니다.', 'Commit message copied to clipboard.'],
  selectFile:         ['파일을 선택하세요', 'Select a file'],
  noDiffFiles:        ['변경된 파일이 없습니다.', 'No changed files in this commit.'],
  selectHistoryAction: ['작업을 선택하세요', 'Select an action'],
  // ─── Sidebar sections ──────────────────────────────────
  sectionCommit:      ['변경 사항', 'Changes'],
  sectionHistory:     ['히스토리', 'History'],
  sectionLocalBranch: ['로컬 브랜치', 'Local Branches'],
  sectionRemoteBranch:['원격 브랜치', 'Remote Branches'],
  sectionStash:       ['스태시', 'Stashes'],
  changes:            ['{0}개 변경', '{0} changes'],
  switchSuccess:      ['{0} 브랜치로 전환 완료', 'Switched to branch {0}'],
  enterBranchName:    ['새 브랜치 이름을 입력하세요', 'Enter new branch name'],
  branchCreated:      ['브랜치 생성 완료: {0}', 'Branch created: {0}'],
  // ─── Branch delete ─────────────────────────────────────
  delete:             ['삭제', 'Delete'],
  forceDelete:        ['강제 삭제', 'Force delete'],
  confirmDeleteBranch: ['{0} 브랜치를 삭제합니까?', 'Delete branch {0}?'],
  deleteBranchDetail: [
    '로컬 브랜치를 삭제합니다. 머지되지 않은 커밋이 있으면 삭제되지 않습니다.',
    'Deletes the local branch. It will not be deleted if it has unmerged commits.'
  ],
  confirmForceDeleteBranch: [
    '{0} 브랜치가 머지되지 않았습니다. 강제로 삭제합니까?',
    'Branch {0} is not fully merged. Force delete?'
  ],
  forceDeleteBranchDetail: [
    '머지되지 않은 커밋이 영구적으로 사라질 수 있습니다.',
    'Unmerged commits may be permanently lost.'
  ],
  confirmDeleteRemoteBranch: ['원격 브랜치 {0}을(를) 삭제합니까?', 'Delete remote branch {0}?'],
  deleteRemoteBranchDetail: [
    '원격 저장소에서 브랜치가 삭제됩니다. 되돌리기 어렵습니다.',
    'The branch will be removed from the remote. This is hard to undo.'
  ],
  confirmDeleteRemoteBranch2: [
    '정말로 원격 브랜치 {0}을(를) 삭제하시겠습니까?',
    'Are you absolutely sure you want to delete remote branch {0}?'
  ],
  deleteRemoteBranchDetail2: [
    '이 작업은 되돌릴 수 없습니다.',
    'This action cannot be undone.'
  ],
  deleteBranchSuccess: ['{0} 브랜치를 삭제했습니다.', 'Deleted branch {0}.'],
  // ─── Stash ─────────────────────────────────────────────
  enterStashMessage:  ['스태시 메시지(선택)', 'Stash message (optional)'],
  noChangesToStash:   ['저장할 변경 사항이 없습니다.', 'No local changes to stash.'],
  stashCreated:       [
    '변경 사항(untracked 포함)을 스태시에 저장했습니다.',
    'Saved changes (including untracked files) to stash.'
  ],
  stashPopped:        ['스태시를 복구했습니다.', 'Restored stash.'],
  stashApplied:       ['스태시를 적용했습니다.', 'Applied stash.'],
  stashDropped:       ['스태시를 삭제했습니다.', 'Dropped stash.'],
  stashPopConflict:   [
    '스태시 복구 중 충돌이 발생했습니다. 스태시는 보존되었으니 충돌을 해결하세요.',
    'Conflicts occurred while restoring the stash. The stash was kept — resolve the conflicts.'
  ],
  confirmDropStash:   ['스태시 {0}을(를) 삭제합니까?', 'Drop stash {0}?'],
  dropStashDetail:    [
    '저장된 변경 사항이 영구적으로 사라집니다. 되돌리기 어렵습니다.',
    'The stashed changes will be permanently lost. This is hard to undo.'
  ],
  // ─── Credentials ───────────────────────────────────────
  authUsername:       ['{0} 사용자 이름', 'Username for {0}'],
  authPassword:       ['{0}@{1} 비밀번호', 'Password for {0}@{1}'],
  authRequired:       ['{0} 인증이 필요합니다', 'Authentication required for {0}'],
  authCancelled:      ['인증이 취소되었습니다.', 'Authentication cancelled.'],
  // ─── .gitignore ────────────────────────────────────────
  gitignoreAdded:     ['{0} 항목을 .gitignore에 추가했습니다.', 'Added {0} to .gitignore.'],
  gitignoreAlready:   ['{0} 항목은 이미 .gitignore에 있습니다.', '{0} is already in .gitignore.'],
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

// ─── Custom Askpass & Credential Handling ──────────────────────────
// VS Code 내장 askpass.sh는 IPC 핸들이 필요해 외부 확장에서 재사용 불가.
// 자체 shell askpass를 만들어 GIT_REFLOW_USERNAME/PASSWORD env var로 credential 전달.

let _customAskpassPath = null;
const _credCache = new Map(); // host -> { username, password }

function ensureCustomAskpass(context) {
  if (_customAskpassPath && fs.existsSync(_customAskpassPath)) {
    return _customAskpassPath;
  }
  const dir = context.globalStorageUri
    ? context.globalStorageUri.fsPath
    : path.join(os.tmpdir(), 'git-reflow');
  fs.mkdirSync(dir, { recursive: true });

  const isWin = process.platform === 'win32';
  if (isWin) {
    // Windows: Node.js 스크립트 + 실행용 .bat wrapper
    const jsPath = path.join(dir, 'git-reflow-askpass.js');
    const jsScript = [
      'var p = (process.argv[2] || "").toLowerCase();',
      'var k = p.indexOf("username") !== -1',
      '  ? "GIT_REFLOW_USERNAME" : "GIT_REFLOW_PASSWORD";',
      'process.stdout.write(process.env[k] || "");',
    ].join('\n');
    fs.writeFileSync(jsPath, jsScript);

    const batPath = path.join(dir, 'git-reflow-askpass.bat');
    const nodePath = process.execPath.replace(/\\/g, '\\\\');
    const batScript = `@"${nodePath}" "${jsPath.replace(/\\/g, '\\\\')}" %*\r\n`;
    fs.writeFileSync(batPath, batScript);
    _customAskpassPath = batPath;
  } else {
    // macOS / Linux: shell 스크립트
    const askpassPath = path.join(dir, 'git-reflow-askpass.sh');
    const script = `#!/bin/sh
# git-reflow custom askpass — credentials passed via env vars
case "$1" in
  *[Uu]sername*) printf '%s' "$GIT_REFLOW_USERNAME" ;;
  *)             printf '%s' "$GIT_REFLOW_PASSWORD" ;;
esac
`;
    fs.writeFileSync(askpassPath, script);
    fs.chmodSync(askpassPath, 0o755);
    _customAskpassPath = askpassPath;
  }
  return _customAskpassPath;
}

async function promptCredentials(host, knownUsername) {
  let username = knownUsername;
  if (!username) {
    username = await vscode.window.showInputBox({
      prompt: t('authUsername', host),
      ignoreFocusOut: true,
    });
    if (!username) return null;
  }
  const password = await vscode.window.showInputBox({
    prompt: t('authPassword', username, host),
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) return null;
  return { username, password };
}

// auth 실패 시 credential 프롬프트 + 재시도 (HTTP(S) 원격에만 적용)
// 에러 메시지에서 URL을 직접 추출해 여러 remote 환경에서도 정확히 동작
async function retryWithCredentials(args, cwd, options, origErr) {
  const target = parseAuthTargetFromError(origErr);
  if (!target) throw origErr;

  const { host, username: urlUsername } = target;
  const cacheKey = urlUsername ? `${urlUsername}@${host}` : host;
  let creds = _credCache.get(cacheKey);
  if (!creds) {
    vscode.window.showInformationMessage(t('authRequired', host));
    creds = await promptCredentials(host, urlUsername);
    if (!creds) {
      vscode.window.showWarningMessage(t('authCancelled'));
      throw origErr;
    }
  }

  if (!_customAskpassPath) throw origErr;

  const authEnv = {
    ...buildGitEnv(),
    ...(options.env || {}),
    GIT_ASKPASS: _customAskpassPath,
    GIT_REFLOW_USERNAME: creds.username,
    GIT_REFLOW_PASSWORD: creds.password,
  };

  try {
    const result = await execGit(args, cwd, {
      ...options, env: authEnv, _noAuthRetry: true,
    });
    _credCache.set(cacheKey, creds);
    return result;
  } catch (retryErr) {
    if (isAuthError(retryErr)) _credCache.delete(cacheKey);
    throw retryErr;
  }
}

// 내부 헬퍼용 (로그 없이 실행 — status, rev-parse 등 빈번한 조회)
async function execGitSilent(args, cwd, options = {}) {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024,
    env: buildGitEnv(),
    ...options,
  });
}

// 사용자 명령용 (출력 로그에 기록 + 자동 표시)
// options._silent: true → outputChannel 로그/표시 생략 (백그라운드 조회용, auth retry는 유지)
async function execGit(args, cwd, options = {}) {
  const { _noAuthRetry, _silent, ...execOptions } = options;
  const cmdStr = `git ${args.join(' ')}`;
  if (outputChannel && !_silent) {
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] $ ${cmdStr}`);
    // 출력 패널 자동 표시는 하지 않음 — 하단에 열어둔 터미널이 멋대로 출력 로그로 전환되는 것 방지
    // (로그는 계속 기록되므로 필요하면 "출력" 패널에서 직접 확인 가능)
  }
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 1024 * 1024,
      env: buildGitEnv(),
      ...execOptions,
    });
    if (outputChannel && !_silent) {
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
    // 인증 에러면 credential 프롬프트 + 1회 재시도
    if (!_noAuthRetry && isAuthError(err)) {
      try {
        return await retryWithCredentials(args, cwd, { ...execOptions, _silent }, err);
      } catch (retryErr) {
        if (outputChannel && !_silent) {
          const errMsg = (retryErr.stderr || '') + (retryErr.stdout || '')
            || retryErr.message || String(retryErr);
          outputChannel.appendLine(`[ERROR] ${errMsg.trimEnd()}`);
          outputChannel.appendLine('');
        }
        throw retryErr;
      }
    }
    if (outputChannel && !_silent) {
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
  // branch --show-current 는 커밋이 하나도 없는(unborn) 저장소에서도 정상 동작한다.
  // rev-parse --abbrev-ref HEAD 는 커밋이 없으면 exit 128 로 실패해 _fetchStatus 가
  // catch 로 빠지면서 _checkedFiles 를 비워버린다(Select All 이 동작하지 않는 원인).
  const { stdout } = await execGitSilent(['branch', '--show-current'], cwd);
  const branch = stdout.trim();
  if (branch) return branch;
  // detached HEAD 에서는 --show-current 가 빈 문자열을 반환하므로 기존 방식으로 보완
  try {
    const { stdout: rev } = await execGitSilent(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return rev.trim();
  } catch {
    return '';
  }
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

async function getRemoteNames(cwd) {
  try {
    const { stdout } = await execGitSilent(['remote'], cwd);
    return stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ls-remote 로 원격의 브랜치 이름만 빠르게 조회 (객체 전송 없음)
// execGit(_silent) 로 호출 — 출력 패널 노이즈 없이 fetchAll 에서 캐시된 creds 재사용
async function lsRemoteHeads(cwd, remote) {
  try {
    const { stdout } = await execGit(
      ['ls-remote', '--heads', remote], cwd, { timeout: 15000, _silent: true }
    );
    if (!stdout.trim()) return [];
    return stdout.trim().split('\n').map(line => {
      const tabIdx = line.indexOf('\t');
      if (tabIdx < 0) return null;
      const ref = line.substring(tabIdx + 1);
      const name = ref.replace(/^refs\/heads\//, '');
      return `${remote}/${name}`;
    }).filter(Boolean);
  } catch (err) {
    if (outputChannel) {
      outputChannel.appendLine(`[WARN] ls-remote ${remote} failed: ${err.message || err}`);
    }
    return [];
  }
}

async function getRemoteBranches(cwd) {
  // 1) 로컬 추적 중인 원격 ref — 커밋 메시지/날짜 포함
  const { stdout } = await execGitSilent([
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(subject)%09%(committerdate:relative)%09%(symref)',
    'refs/remotes/',
  ], cwd);
  const tracked = new Map();
  if (stdout.trim()) {
    for (const line of stdout.trim().split('\n')) {
      const [name, subject, relTime, symref] = line.split('\t');
      if (symref) continue; // origin/HEAD 등 심볼릭 ref 제외
      tracked.set(name, { name, description: `${subject} (${relTime})` });
    }
  }

  // 2) ls-remote 로 원격 브랜치 이름만 덧붙임 (미페치 표시)
  const remotes = await getRemoteNames(cwd);
  const remoteLists = await Promise.all(remotes.map(r => lsRemoteHeads(cwd, r)));
  const unfetched = [];
  for (const names of remoteLists) {
    for (const name of names) {
      if (!tracked.has(name)) {
        unfetched.push({ name, description: t('notFetched'), unfetched: true });
      }
    }
  }
  unfetched.sort((a, b) => a.name.localeCompare(b.name));

  return [...tracked.values(), ...unfetched];
}

async function fetchAll(cwd) {
  await execGit(['fetch', '--all'], cwd, { timeout: 30000 });
}

// 스태시 목록 조회 — [{ ref, index, message, relTime }]
async function getStashList(cwd) {
  try {
    const { stdout } = await execGitSilent(
      ['stash', 'list', '--format=%gd%x09%s%x09%cr'], cwd
    );
    return parseStashList(stdout);
  } catch {
    return [];
  }
}

// 한 스태시에 포함된 파일 목록 (commit 파일 표시와 동일한 형식)
// --include-untracked: 스태시 생성 시 함께 저장한 untracked 파일도 목록에 포함
async function getStashFiles(cwd, ref) {
  try {
    const { stdout } = await execGitSilent(
      ['stash', 'show', '--include-untracked', '--no-renames', '--name-status', ref], cwd
    );
    return parseNameStatus(stdout);
  } catch {
    return [];
  }
}

// 해당 원격 브랜치가 로컬에 추적되지 않았으면 네트워크에서 페치
async function ensureRemoteBranchFetched(cwd, branchName) {
  try {
    await execGitSilent(
      ['rev-parse', '--verify', `refs/remotes/${branchName}`], cwd
    );
    return;
  } catch {
    // 추적 ref 없음 → 개별 페치
  }
  const slash = branchName.indexOf('/');
  if (slash < 0) return;
  const remote = branchName.substring(0, slash);
  const name = branchName.substring(slash + 1);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('fetchingBranch', branchName) },
    () => execGit(['fetch', remote, name], cwd, { timeout: 60000 })
  );
}

// 로컬에 해당 이름의 브랜치가 존재하는지 확인
async function localBranchExists(cwd, name) {
  try {
    await execGitSilent(['rev-parse', '--verify', `refs/heads/${name}`], cwd);
    return true;
  } catch {
    return false;
  }
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
  const { stdout } = await execGitSilent(
    ['status', '--porcelain', '--no-renames', '-uall'], cwd
  );
  if (!stdout.trim()) return [];

  // git check-ignore로 무시 대상 필터링
  const files = stdout.trimEnd().split('\n').map(line => {
    const indexStatus = line[0];
    const workStatus = line[1];
    const filePath = line.substring(3);
    // 머지/리베이스 충돌(unmerged) 상태: UU/AA/DD/AU/UD/UA/DU
    const isConflict = isUnmergedStatus(indexStatus, workStatus);
    const isStaged = indexStatus !== ' ' && indexStatus !== '?';
    const statusCode = isStaged ? indexStatus : (workStatus === '?' ? '?' : workStatus);
    return { filePath, statusCode, isStaged, isConflict };
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

// 파일 상태 코드를 파일 목록에 표시할 한 글자로 변환
// M(수정)→U(Update), A/?(신규)→A(Add), D(삭제)→D(Delete), 그 외는 원본 코드
function fileStatusLetter(statusCode) {
  if (statusCode === 'M') return 'U';
  if (statusCode === 'A' || statusCode === '?') return 'A';
  if (statusCode === 'D') return 'D';
  return statusCode;
}

// 변경 파일 클릭 시 실행할 명령과 인자 반환 (트리/인라인 webview 공통)
//  - 충돌: Merge Editor / 수정: diff / 신규: 파일 열기 / 삭제: 삭제 diff
function fileOpenCommand(f, cwd) {
  const fileUri = vscode.Uri.file(path.join(cwd, f.filePath));
  if (f.isConflict) return ['gitReflow.openConflictMergeEditor', f.filePath];
  if (f.statusCode === 'M') return ['gitReflow.openFileDiff', fileUri];
  if (f.statusCode === 'D') return ['gitReflow.openDeletedFileDiff', f.filePath];
  return ['vscode.open', fileUri];
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

// 커밋 표시 필드별 값 추출기 (설정 commitFieldOrder의 키와 1:1)
const COMMIT_FIELD_VALUE = {
  message: c => c.message,
  author:  c => c.author,
  date:    c => c.date,
  hash:    c => c.hash.substring(0, 8),
};

// 필드별 고정 글자폭 — 메시지는 가변, 나머지는 칸 정렬용 고정폭
// (트리뷰 description은 가변폭 폰트라 완벽 정렬은 아니고 글자수 기준 근사 정렬)
const COMMIT_FIELD_WIDTH = { author: 10, date: 19, hash: 8 };

// 텍스트를 지정 글자폭에 맞춤 — 길면 …로 자르고, 짧으면 공백으로 채움
function fitWidth(text, width) {
  const s = String(text);
  if (!width) return s;
  if (s.length > width) return s.substring(0, width - 1) + '…';
  return s.padEnd(width, ' ');
}

// 설정에서 커밋 필드 순서를 읽어 유효 키 배열로 반환 (잘못된 값은 기본 순서)
function getCommitFieldOrder() {
  const defaultOrder = ['message', 'date', 'author', 'hash'];
  const raw = vscode.workspace.getConfiguration('gitReflow')
    .get('commitFieldOrder', defaultOrder.join(','));
  const fields = raw.split(',').map(s => s.trim()).filter(f => COMMIT_FIELD_VALUE[f]);
  return fields.length ? fields : defaultOrder;
}

// 커밋 → 트리 항목 표시값 — 첫 필드는 밝은 label(폭 고정 안 함), 나머지는 흐린 description
function formatCommitLabel(c) {
  const [first, ...rest] = getCommitFieldOrder();
  return {
    label: COMMIT_FIELD_VALUE[first](c),
    description: rest.map(f => fitWidth(COMMIT_FIELD_VALUE[f](c), COMMIT_FIELD_WIDTH[f])).join('  '),
  };
}

// 커밋 항목 툴팁 — 날짜 / 작성자 / 해시 / 메시지 순
function buildCommitTooltip(c) {
  return [
    `${t('tipDate')}: ${c.date}`,
    `${t('tipAuthor')}: ${c.author}`,
    `${t('tipHash')}: ${c.hash}`,
    `${t('tipMessage')}: ${c.message}`,
  ].join('\n');
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

// ─── Inline Git Blame Decoration ────────────────────────────────────

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
  const diff = now - timestamp;
  if (diff < 60) return isKo ? '방금 전' : 'just now';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return isKo ? `${m}분 전` : `${m} min ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return isKo ? `${h}시간 전` : `${h} hours ago`;
  }
  if (diff < 2592000) {
    const d = Math.floor(diff / 86400);
    return isKo ? `${d}일 전` : `${d} days ago`;
  }
  if (diff < 31536000) {
    const mo = Math.floor(diff / 2592000);
    return isKo ? `${mo}개월 전` : `${mo} months ago`;
  }
  const y = Math.floor(diff / 31536000);
  return isKo ? `${y}년 전` : `${y} years ago`;
}

function scheduleBlameUpdate(editor) {
  if (blameTimeout) clearTimeout(blameTimeout);
  blameTimeout = setTimeout(() => updateInlineBlame(editor), 150);
}

// ─── Commit Input WebviewView ───────────────────────────────────────

class CommitInputViewProvider {
  constructor(globalState) {
    this._view = null;
    this._message = '';
    this._globalState = globalState;
    this._onDidCommit = new vscode.EventEmitter();
    this.onDidCommit = this._onDidCommit.event;
    this._pendingResolve = null; // squash 등 외부에서 메시지 대기 시 사용
    this._branchDescription = ''; // 타이틀 옆 브랜치 정보
  }

  // "메시지 입력" 뷰 타이틀 옆에 브랜치 정보 표시
  setBranchDescription(text) {
    this._branchDescription = text || '';
    if (this._view) {
      this._view.description = this._branchDescription;
    }
  }

  /**
   * 사이드바 메시지 입력창에 텍스트를 세팅하고, 커밋 버튼을 누를 때까지 대기.
   * 커밋 버튼 누르면 입력된 메시지로 resolve, 취소(ESC 등)되면 undefined.
   * @param {string} defaultMsg 기본 메시지
   * @param {string} [buttonLabel] 커밋 버튼에 표시할 임시 라벨
   */
  waitForCommit(defaultMsg, buttonLabel) {
    // 기존 대기 취소
    if (this._pendingResolve) {
      this._pendingResolve(undefined);
      this._pendingResolve = null;
    }
    this.setMessage(defaultMsg);
    // 버튼 라벨 저장 (resolveWebviewView에서 복원용)
    this._pendingButtonLabel = buttonLabel || null;
    // 버튼 라벨 변경
    if (buttonLabel && this._view) {
      this._view.webview.postMessage({ type: 'setButtonLabel', value: buttonLabel });
    }
    // 취소 버튼 표시
    const cancelLabel = isKo ? '취소' : 'Cancel';
    this._pendingCancelLabel = cancelLabel;
    if (this._view) {
      this._view.webview.postMessage({ type: 'showCancel', value: cancelLabel });
    }
    // 사이드바 패널 포커스
    vscode.commands.executeCommand('gitQuickPickCommitInput.focus');
    const restoreLabel = () => {
      this._pendingButtonLabel = null;
      this._pendingCancelLabel = null;
      if (this._view) {
        const original = isKo ? '\u2713 커밋' : '\u2713 Commit';
        this._view.webview.postMessage({ type: 'setButtonLabel', value: original });
        this._view.webview.postMessage({ type: 'hideCancel' });
      }
      this.clearMessage();
    };
    return new Promise((resolve) => {
      this._pendingResolve = (value) => {
        restoreLabel();
        resolve(value);
      };
    });
  }

  cancelWait() {
    if (this._pendingResolve) {
      this._pendingResolve(undefined);
      this._pendingResolve = null;
    }
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
    webviewView.description = this._branchDescription;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    if (this._message) {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'restore', value: this._message });
        // 패널이 닫혀있다가 열릴 때 버튼 라벨/취소 버튼 복원 (squash/amend 등)
        if (this._pendingButtonLabel) {
          webviewView.webview.postMessage({ type: 'setButtonLabel', value: this._pendingButtonLabel });
        }
        if (this._pendingCancelLabel) {
          webviewView.webview.postMessage({ type: 'showCancel', value: this._pendingCancelLabel });
        }
      }, 100);
    }

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'input') {
        this._message = msg.value;
      } else if (msg.type === 'commit') {
        this._message = msg.value;
        if (this._pendingResolve) {
          // squash 등 외부 대기 중이면 그쪽으로 전달
          const resolve = this._pendingResolve;
          this._pendingResolve = null;
          resolve(msg.value);
        } else {
          this._onDidCommit.fire(msg.value);
        }
      } else if (msg.type === 'cancel') {
        this.cancelWait();
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
  html, body { background: transparent; }
  body {
    padding: 4px;
  }
  .input-wrap {
    display: flex;
    align-items: flex-start;
    gap: 2px;
    min-height: 26px;
  }
  textarea {
    flex: 1;
    height: 60px;
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
  #cancelBtn {
    flex-shrink: 0;
    width: 100%;
    margin-top: 2px;
    padding: 4px 0;
    border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-input-border, #3c3c3c));
    border-radius: 2px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    cursor: pointer;
  }
  #cancelBtn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
</style>
</head>
<body>
  <div class="input-wrap">
    <textarea id="msg" rows="1" placeholder="${placeholder}"></textarea>
    <button id="historyBtn" title="${recentLabel}"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.2a5.8 5.8 0 1 1 0 11.6A5.8 5.8 0 0 1 8 2.2zM7.4 4v4.4l3.2 1.9.6-1-2.6-1.5V4H7.4z"/></svg></button>
  </div>
  <button id="commitBtn">&#x2713; ${commitLabel}</button>
  <button id="cancelBtn" style="display:none"></button>
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

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const cancelBtn = document.getElementById('cancelBtn');
        if (cancelBtn.style.display !== 'none') {
          e.preventDefault();
          vscode.postMessage({ type: 'cancel' });
        }
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data.type === 'clear') { ta.value = ''; }
      if (e.data.type === 'restore') { ta.value = e.data.value; }
      if (e.data.type === 'setButtonLabel') {
        document.getElementById('commitBtn').textContent = e.data.value;
      }
      if (e.data.type === 'showCancel') {
        const cancelBtn = document.getElementById('cancelBtn');
        cancelBtn.textContent = e.data.value;
        cancelBtn.style.display = '';
      }
      if (e.data.type === 'hideCancel') {
        document.getElementById('cancelBtn').style.display = 'none';
      }
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

// ─── Conflict Handling ──────────────────────────────────────────────

async function getConflictedFiles(cwd) {
  // git ls-files -u: 인덱스의 unmerged stage(1/2/3) 항목을 직접 조회.
  // modify/delete 포함 모든 충돌 유형을 놓치지 않고 잡는다.
  try {
    const { stdout } = await execGitSilent(['ls-files', '-u'], cwd);
    const files = new Set();
    for (const line of stdout.split('\n')) {
      // 형식: <mode> <hash> <stage>\t<path>
      const m = line.match(/^\S+\s+\S+\s+[123]\t(.+)$/);
      if (m) files.add(m[1]);
    }
    return Array.from(files);
  } catch {
    return [];
  }
}

// 파일의 충돌 stage 집합 조회 (1=base, 2=ours, 3=theirs)
async function getConflictStages(cwd, file) {
  const stages = new Set();
  try {
    const { stdout } = await execGitSilent(['ls-files', '-u', '--', file], cwd);
    for (const line of stdout.split('\n')) {
      // 형식: <mode> <hash> <stage>\t<path>
      const m = line.match(/^\S+\s+\S+\s+([123])\s/);
      if (m) stages.add(m[1]);
    }
  } catch { /* no conflict info */ }
  return stages;
}

// modify/delete 충돌: 한 쪽에서 파일이 삭제되고 다른 쪽에서 수정된 경우
async function resolveModifyDeleteConflict(cwd, file, stages) {
  const deletedByOurs = !stages.has('2');   // ours(HEAD)에서 삭제
  const deletedByTheirs = !stages.has('3'); // theirs(incoming)에서 삭제

  const detail = deletedByTheirs ? t('deletedByIncoming')
    : deletedByOurs ? t('deletedByCurrent')
    : '';

  const keepDeletion = t('keepDeletion');
  const keepFile = t('keepFile');
  const openFile = t('openFileToReview');

  const choice = await vscode.window.showWarningMessage(
    t('modifyDeleteTitle', file),
    { modal: true, detail },
    keepDeletion,
    keepFile,
    openFile
  );

  if (choice === keepDeletion) {
    await execGit(['rm', '-f', '--', file], cwd);
    vscode.window.showInformationMessage(t('modifyDeleteResolvedDeleted', file));
  } else if (choice === keepFile) {
    // 작업 트리에 파일이 없으면 살아있는 stage(2 또는 3) 내용을 복원
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) {
      const aliveStage = stages.has('2') ? '2' : stages.has('3') ? '3' : null;
      if (aliveStage) {
        const { stdout } = await execGitSilent(['show', `:${aliveStage}:${file}`], cwd);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, stdout);
      }
    }
    await execGit(['add', '--', file], cwd);
    vscode.window.showInformationMessage(t('modifyDeleteResolvedKept', file));
  } else if (choice === openFile) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath)) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    }
  }
}

// 같은 파일을 가리키는 특정 종류의 탭을 모두 닫는다.
//  kind 'text'  : 일반 텍스트 에디터(TabInputText)        — uri 일치
//  kind 'merge' : 3-way 머지 에디터(TabInputTextMerge)    — result(워킹트리 파일) 일치
// 마커 에디터와 머지 에디터가 같은 파일에 동시에 열리는 것을 막는다.
async function closeEditorsForFile(uri, kind) {
  const target = uri.toString();
  const toClose = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      const isText = kind === 'text'
        && vscode.TabInputText && input instanceof vscode.TabInputText
        && input.uri.toString() === target;
      const isMerge = kind === 'merge'
        && vscode.TabInputTextMerge && input instanceof vscode.TabInputTextMerge
        && input.result.toString() === target;
      if (isText || isMerge) toClose.push(tab);
    }
  }
  if (toClose.length) {
    try { await vscode.window.tabGroups.close(toClose); } catch { /* 사용자가 닫기 취소 등 — 무시 */ }
  }
}

// 워킹트리의 상대경로 파일을 일반 에디터로 연다.
// 삭제됐거나 워킹트리에 없는 파일은 안내만 한다(조용한 실패 방지).
function openWorkingFile(relativePath) {
  const cwd = getWorkspaceCwd();
  if (!cwd || !relativePath) return;
  const absPath = path.join(cwd, relativePath);
  if (!fs.existsSync(absPath)) {
    vscode.window.showInformationMessage(t('fileNotInWorkspace', relativePath));
    return;
  }
  vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: false });
}

// 충돌 파일을 충돌 마커(<<<<<<< ======= >>>>>>>)가 보이는 텍스트 에디터로 연다.
// VS Code 머지 에디터를 한 번 열면 워킹트리 파일에서 마커가 사라질 수 있으므로,
// 마커가 없고 아직 unmerged 상태면 git checkout --merge 로 마커를 재생성한 뒤 연다.
async function openConflictFileWithMarkers(cwd, file) {
  if (!cwd || !file) return;
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs)) {
    vscode.window.showInformationMessage(t('fileNotInWorkspace', file));
    return;
  }

  let hasMarkers = false;
  try { hasMarkers = fs.readFileSync(abs, 'utf8').includes('<<<<<<<'); } catch { /* 바이너리 등 */ }

  let regenerated = false;
  if (!hasMarkers) {
    // 인덱스에 unmerged stage(1/2/3)가 남아 있을 때만 마커 재생성이 가능하다.
    const stages = await getConflictStages(cwd, file);
    if (stages.size > 0) {
      // checkout --merge 는 워킹트리 파일을 원래 충돌 버전으로 덮어쓴다.
      // 머지 에디터에서 이미 해결한 내용이 있을 수 있으므로, 덮어쓰기 전에 확인한다.
      const restore = t('conflictRestore');
      const openAsIs = t('conflictOpenAsIs');
      const choice = await vscode.window.showWarningMessage(
        t('conflictRestoreTitle', file),
        { modal: true, detail: t('conflictRestoreDetail') },
        restore,
        openAsIs
      );
      if (choice === undefined) return; // 취소 — 아무것도 열지 않는다.
      if (choice === restore) {
        try {
          await execGit(['checkout', '--merge', '--', file], cwd);
          regenerated = true;
        } catch (err) {
          outputChannel.appendLine(
            `[WARN] checkout --merge failed for ${file}: ${err.message || err}`
          );
        }
      }
      // openAsIs 선택 시: 복원하지 않고 현재 워킹트리 내용 그대로 연다.
    }
  }

  const uri = vscode.Uri.file(abs);
  // 같은 파일의 머지 에디터가 열려 있으면 닫는다(동시 오픈 방지).
  await closeEditorsForFile(uri, 'merge');
  await vscode.window.showTextDocument(uri, { preview: false });
  // git 이 디스크를 다시 쓴 경우, 이미 열려 있던 문서가 옛 내용일 수 있어 디스크와 동기화
  if (regenerated) {
    try { await vscode.commands.executeCommand('workbench.action.files.revert'); }
    catch { /* 활성 에디터 없음 등 — 무시 */ }
  }
}

async function openMergeEditors(cwd, files) {
  for (const file of files) {
    const stages = await getConflictStages(cwd, file);
    // modify/delete 충돌: ours(2) 또는 theirs(3) 중 하나가 없음 → 머지 에디터 부적합
    const isModifyDelete = !stages.has('2') || !stages.has('3');
    if (isModifyDelete) {
      await resolveModifyDeleteConflict(cwd, file, stages);
      continue;
    }

    const resultUri = vscode.Uri.file(path.join(cwd, file));
    // 같은 파일의 일반 에디터가 열려 있으면 닫는다(동시 오픈 방지).
    await closeEditorsForFile(resultUri, 'text');
    try {
      // Git 확장의 공식 명령으로 3-way Merge Editor 열기.
      // 워킹트리의 충돌 파일 Uri만 넘기면 base/ours/theirs는 VS Code가 처리한다.
      await vscode.commands.executeCommand('git.openMergeEditor', resultUri);
    } catch (err) {
      // 머지 에디터를 못 열면 조용히 넘기지 말고 원인을 남기고 일반 에디터로 폴백
      outputChannel.appendLine(
        `[WARN] git.openMergeEditor failed for ${file}: ${err.message || err}`
      );
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
      { modal: true },
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
      { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  await performPush(cwd, currentBranch, force);
}

// upstream 유무 확인 → 일반 push면 원격 새 커밋 확인 → push 실행 (execPush/pushBranch 공통)
async function performPush(cwd, currentBranch, force) {
  let hasUpstream = true;
  try {
    await execGitSilent(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`], cwd);
  } catch {
    hasUpstream = false;
  }

  // 일반 push이고 upstream이 있으면, 원격에 로컬에 없는 커밋이 있는지 확인 후 rebase 선택지 제공
  if (!force && hasUpstream) {
    const decision = await checkRemoteBeforePush(cwd, currentBranch);
    if (decision === 'cancel') return;       // 사용자가 취소
    if (decision === 'rebase-only') return;  // rebase만 하고 push 안 함
    // 'push' | 'rebase-push' 는 아래에서 push 진행
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

// 원격(upstream)에 로컬에 없는 커밋이 있으면 rebase 선택 모달을 띄운다.
// 반환: 'push'(그냥 진행) | 'rebase-push'(rebase 후 push) | 'rebase-only'(rebase만) | 'cancel'
async function checkRemoteBeforePush(cwd, currentBranch) {
  // 최신 원격 상태 확인을 위해 fetch (실패하면 확인 불가 → 그냥 push 진행)
  try {
    const { stdout: remote } = await execGitSilent(['config', `branch.${currentBranch}.remote`], cwd);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('checkingRemote') },
      () => execGit(['fetch', remote.trim()], cwd, { timeout: 30000 })
    );
  } catch {
    return 'push';
  }

  let behind = 0;
  try {
    const { stdout } = await execGitSilent(['rev-list', '--count', 'HEAD..@{upstream}'], cwd);
    behind = parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 'push';
  }
  if (behind === 0) return 'push';

  const rebaseOnly = t('cancelAndRebase');
  const rebasePush = t('rebaseThenPush');
  const choice = await vscode.window.showWarningMessage(
    t('remoteHasCommits', behind),
    { modal: true, detail: t('remoteHasCommitsDetail') + rebaseBackupNote('rebase') },
    rebaseOnly, rebasePush
  );

  if (choice === rebaseOnly) {
    await rebaseOntoUpstream(cwd, currentBranch);
    return 'rebase-only';
  }
  if (choice === rebasePush) {
    const ok = await rebaseOntoUpstream(cwd, currentBranch);
    return ok ? 'rebase-push' : 'cancel'; // rebase 충돌/실패 시 push 안 함
  }
  return 'cancel';
}

// 현재 브랜치를 upstream 위로 rebase. 성공하면 true, 충돌/실패면 false.
async function rebaseOntoUpstream(cwd, currentBranch) {
  const inProgress = await hasInProgressOperation(cwd);
  if (inProgress === 'rebase') { vscode.window.showWarningMessage(t('inProgressRebase')); return false; }
  if (inProgress === 'merge') { vscode.window.showWarningMessage(t('inProgressMerge')); return false; }

  await createRebaseBackupIfEnabled(cwd, currentBranch);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', 'git rebase @{upstream}') },
      () => execGit(['rebase', '@{upstream}'], cwd)
    );
    vscode.window.showInformationMessage(t('success', 'git rebase'));
    return true;
  } catch (err) {
    await handleGitError(err, 'rebase', cwd);
    return false;
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
    // 사용자가 -f로 강제 추가한 ignore 파일도 다시 스테이징되도록 --force 사용
    await execGit(['add', '--force', '--', ...checkedFiles], cwd);
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

// 현재 브랜치를 원격(origin/현재브랜치)으로 강제 리셋 — 로컬 변경/커밋이 사라진다.
async function execForcePull() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  if (await isDetachedHead(cwd)) {
    vscode.window.showErrorMessage(t('detachedHead'));
    return;
  }

  const currentBranch = await getCurrentBranch(cwd);
  const confirm = await vscode.window.showWarningMessage(
    t('forcePullConfirm', currentBranch), { modal: true }, t('yes')
  );
  if (confirm !== t('yes')) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git fetch + reset ${currentBranch}`) },
      async () => {
        await execGit(['fetch', 'origin', currentBranch], cwd);
        await execGit(['reset', '--hard', `origin/${currentBranch}`], cwd);
      }
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

async function execDeleteBranch(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const confirm = await vscode.window.showWarningMessage(
    t('confirmDeleteBranch', branchName),
    { modal: true, detail: t('deleteBranchDetail') },
    t('delete')
  );
  if (confirm !== t('delete')) return;

  try {
    await execGit(['branch', '-d', branchName], cwd);
    vscode.window.showInformationMessage(t('deleteBranchSuccess', branchName));
  } catch (err) {
    const msg = (err.stderr || err.message || String(err)).trim();
    // 머지되지 않은 브랜치 → 강제 삭제 여부 재확인
    if (/not fully merged/i.test(msg)) {
      const force = await vscode.window.showWarningMessage(
        t('confirmForceDeleteBranch', branchName),
        { modal: true, detail: t('forceDeleteBranchDetail') },
        t('forceDelete')
      );
      if (force !== t('forceDelete')) return;
      try {
        await execGit(['branch', '-D', branchName], cwd);
        vscode.window.showInformationMessage(t('deleteBranchSuccess', branchName));
      } catch (err2) {
        vscode.window.showErrorMessage(t('failed', (err2.stderr || err2.message || String(err2)).trim()));
      }
    } else {
      vscode.window.showErrorMessage(t('failed', msg));
    }
  }
}

async function execDeleteRemoteBranch(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName; // 예: origin/feature
  const slash = branchName.indexOf('/');
  if (slash < 0) return;
  const remote = branchName.substring(0, slash);
  const name = branchName.substring(slash + 1);

  // 원격은 실수 방지를 위해 두 번 확인
  const confirm1 = await vscode.window.showWarningMessage(
    t('confirmDeleteRemoteBranch', branchName),
    { modal: true, detail: t('deleteRemoteBranchDetail') },
    t('delete')
  );
  if (confirm1 !== t('delete')) return;

  const confirm2 = await vscode.window.showWarningMessage(
    t('confirmDeleteRemoteBranch2', branchName),
    { modal: true, detail: t('deleteRemoteBranchDetail2') },
    t('delete')
  );
  if (confirm2 !== t('delete')) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification,
        title: t('executing', `git push ${remote} --delete ${name}`) },
      () => execGit(['push', remote, '--delete', name], cwd)
    );
    vscode.window.showInformationMessage(t('deleteBranchSuccess', branchName));
  } catch (err) {
    vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
  }
}

async function execStageFile(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;
  await execGit(['add', '--', item.filePath], cwd);
}

// 탐색기 우클릭 → .gitignore로 제외된 파일도 강제로 add (다중 선택 지원)
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

  const lines = content.split(/\r?\n/).map(l => l.trim());
  if (lines.includes(entry) || lines.includes(item.filePath)) {
    vscode.window.showInformationMessage(t('gitignoreAlready', item.filePath));
    return;
  }

  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gitignorePath, prefix + entry + '\n');
  vscode.window.showInformationMessage(t('gitignoreAdded', item.filePath));
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
  const targetName = isRemote ? branchName.replace(/^[^/]+\//, '') : branchName;

  if (isRemote && item.unfetched) {
    try {
      await ensureRemoteBranchFetched(cwd, branchName);
      item.unfetched = false;
    } catch (err) {
      vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
      return;
    }
  }

  // 원격 브랜치: 같은 이름의 로컬 브랜치가 이미 있으면 새로 만들지 않고 전환만 한다
  const createLocal = isRemote && !(await localBranchExists(cwd, targetName));

  const doSwitch = async (force) => {
    const args = ['switch'];
    if (force) args.push('--force');
    if (createLocal) {
      args.push('-c', targetName, branchName);
    } else {
      args.push(targetName);
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${args.join(' ')}`) },
      () => execGit(args, cwd)
    );
    vscode.window.showInformationMessage(t('switchSuccess', targetName));
  };

  try {
    await doSwitch(false);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    if (!msg.includes('overwritten by checkout') && !msg.includes('would be overwritten')) {
      vscode.window.showErrorMessage(t('failed', msg.trim()));
      return;
    }
    const forceLabel = isKo ? '강제 전환 (변경사항 삭제)' : 'Force Switch (discard changes)';
    const choice = await vscode.window.showWarningMessage(
      isKo ? '커밋하지 않은 변경사항이 있어 브랜치를 전환할 수 없습니다. 변경사항을 커밋한 뒤 다시 시도하거나, 강제 전환하세요.'
            : 'Cannot switch branches: you have uncommitted changes. Commit your changes first, or force switch.',
      { modal: true },
      forceLabel
    );
    if (choice === forceLabel) {
      try {
        await doSwitch(true);
      } catch (forceErr) {
        const forceMsg = forceErr.stderr || forceErr.message || String(forceErr);
        vscode.window.showErrorMessage(t('failed', forceMsg.trim()));
      }
    }
  }
}

function isRebaseBackupEnabled() {
  return vscode.workspace.getConfiguration('gitReflow').get('backupBeforeRebase', true);
}

// 백업 정리 설정 — 그룹별 최신 N개 유지 / N일 지난 것 삭제
function getBackupMaxKeep() {
  return vscode.workspace.getConfiguration('gitReflow').get('backupMaxKeep', 10);
}
function getBackupMaxAgeDays() {
  return vscode.workspace.getConfiguration('gitReflow').get('backupMaxAgeDays', 30);
}

// rebase 확인 모달에 붙일 백업 안내 문구 (설정 꺼져 있으면 빈 문자열)
function rebaseBackupNote(action) {
  if (action !== 'rebase' || !isRebaseBackupEnabled()) return '';
  return t('rebaseBackupNote');
}

// rebase 직전 복구용 백업 브랜치 생성. 설정이 꺼져 있으면 아무것도 안 함.
// 백업 실패는 rebase를 막지 않고 경고만 표시 (git ORIG_HEAD 가 fallback).
async function createRebaseBackupIfEnabled(cwd, currentBranch) {
  if (!isRebaseBackupEnabled()) return;

  // 현재 HEAD 커밋을 이미 가리키는 백업이 있으면 중복 생성하지 않고 재사용
  const existing = await findBackupAtHead(cwd, currentBranch);
  if (existing) {
    vscode.window.showInformationMessage(t('backupReused', existing));
    return;
  }

  const backupName = buildRebaseBackupName(currentBranch);
  try {
    await execGit(['branch', backupName, 'HEAD'], cwd, { _silent: true });
    vscode.window.showInformationMessage(t('backupCreated', backupName));
  } catch (err) {
    const msg = (err.stderr || err.message || String(err)).trim();
    vscode.window.showWarningMessage(t('backupFailed', msg));
  }
}

// 현재 HEAD 커밋을 이미 가리키는 backup/<branch>/* 브랜치 이름을 반환 (없으면 null).
// HEAD 조회나 목록 조회가 실패하면 null 을 돌려줘 새 백업을 만들도록 둔다.
async function findBackupAtHead(cwd, currentBranch) {
  let headSha;
  try {
    const { stdout } = await execGitSilent(['rev-parse', 'HEAD'], cwd);
    headSha = stdout.trim();
  } catch {
    return null;
  }
  if (!headSha) return null;

  try {
    const { stdout } = await execGitSilent(
      ['for-each-ref', '--format=%(objectname) %(refname:short)',
        `refs/heads/backup/${currentBranch}`], cwd
    );
    for (const line of stdout.split('\n')) {
      const idx = line.indexOf(' ');
      if (idx === -1) continue;
      if (line.slice(0, idx) === headSha) return line.slice(idx + 1).trim();
    }
  } catch {
    // 목록 조회 실패는 무시 — 새 백업을 만들도록 둠
  }
  return null;
}

// 모든 backup/* 브랜치 이름 목록을 반환 (없으면 빈 배열)
async function listBackupBranches(cwd) {
  try {
    const { stdout } = await execGitSilent(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads/backup'], cwd
    );
    return stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// 오래된 백업 브랜치 정리 (수동 명령). 설정 기준으로 삭제 대상을 계산해 확인 후 삭제.
async function execCleanupBackups() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const names = await listBackupBranches(cwd);
  const stale = selectStaleBackups(names, {
    maxKeep: getBackupMaxKeep(),
    maxAgeDays: getBackupMaxAgeDays(),
  });

  if (stale.length === 0) {
    vscode.window.showInformationMessage(t('cleanupBackupsNone'));
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    t('confirmCleanupBackups', stale.length),
    { modal: true, detail: t('cleanupBackupsDetail', stale.join('\n')) },
    t('delete')
  );
  if (confirm !== t('delete')) return;

  let ok = 0;
  let fail = 0;
  for (const name of stale) {
    try {
      await execGit(['branch', '-D', name], cwd, { _silent: true });
      ok++;
    } catch {
      fail++;
    }
  }

  if (fail === 0) {
    vscode.window.showInformationMessage(t('cleanupBackupsDone', ok));
  } else {
    vscode.window.showWarningMessage(t('cleanupBackupsPartial', ok, fail));
  }
}

// ─── Stash ──────────────────────────────────────────────────────────

// 현재 변경 사항을 스태시에 저장 (untracked 포함 → 워킹트리를 깨끗하게)
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

// 스태시 복구 (pop: 적용 후 삭제 / apply: 적용 후 보존)
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

// 스태시 삭제 (확인 후)
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

  if (item.unfetched) {
    try {
      await ensureRemoteBranchFetched(cwd, selectedBranch);
      item.unfetched = false;
    } catch (err) {
      vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
      return;
    }
  }

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
    confirmMsg, { modal: true, detail: detail + rebaseBackupNote(action) }, actionLabel
  );
  if (confirm !== actionLabel) return;

  const gitArgs = action === 'rebase'
    ? ['rebase', selectedBranch]
    : ['merge', '--no-edit', selectedBranch];
  const gitCmd = `git ${gitArgs.join(' ')}`;

  if (action === 'rebase') {
    await createRebaseBackupIfEnabled(cwd, currentBranch);
  }

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
      { modal: true }, t('yes')
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

// 커밋 해시를 8자 약식으로 클립보드에 복사하고 안내 메시지를 띄운다.
async function copyShortHash(hash) {
  const shortHash = hash.substring(0, 8);
  await vscode.env.clipboard.writeText(shortHash);
  vscode.window.showInformationMessage(t('hashCopied', shortHash));
}

async function copyHash(item) {
  await copyShortHash(item.commitHash);
}

async function copyCommitMessage(itemOrHash) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;
  const hash = typeof itemOrHash === 'string' ? itemOrHash : itemOrHash && itemOrHash.commitHash;
  if (!hash) return;
  try {
    const { stdout } = await execGit(['show', '-s', '--format=%B', hash], cwd);
    await vscode.env.clipboard.writeText(stdout.replace(/\s+$/, ''));
    vscode.window.showInformationMessage(t('messageCopied'));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
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

// 커밋 시점의 파일 내용을 현재 로컬 작업 파일과 비교
async function openCommitFileVsLocal(hash, filePath, cwd) {
  try {
    const commitUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const workingUri = vscode.Uri.file(path.join(cwd, filePath));
    const title = `${filePath} (${hash.substring(0, 8)} ↔ ${t('local')})`;
    await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function openDeletedFileDiff(filePath) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;
  try {
    const headUri = vscode.Uri.parse(
      `gitreflow://show/HEAD/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const emptyUri = vscode.Uri.parse(
      `gitreflow://empty/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const title = `${filePath} (Deleted)`;
    await vscode.commands.executeCommand('vscode.diff', headUri, emptyUri, title);
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
    label + '?', { modal: true }, t('yes')
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

async function execSquashCommits(item, commitInputProvider) {
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

  // 사이드바 메시지 입력창에 기존 메시지를 세팅하고 커밋 버튼 대기
  const squashLabel = isKo ? '커밋 합치기' : 'Squash Commits';
  vscode.window.showInformationMessage(
    isKo
      ? `${commits.length}개 커밋을 합칩니다. 메시지를 수정한 뒤 [${squashLabel}] 버튼을 누르세요.`
      : `Squashing ${commits.length} commits. Edit the message and press [${squashLabel}].`
  );
  const userMsg = await commitInputProvider.waitForCommit(defaultMsg, squashLabel);
  if (!userMsg || !userMsg.trim()) return;

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

    commitInputProvider.addHistory(userMsg);
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

async function execAmendMessage(item, commitInputProvider) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const hash = item.commitHash;

  // 선택된 커밋이 실제 HEAD인지 확인 (히스토리가 오래된 경우 방어)
  try {
    const { stdout } = await execGitSilent(['rev-parse', 'HEAD'], cwd);
    if (stdout.trim() !== hash) {
      vscode.window.showWarningMessage(
        isKo
          ? '히스토리가 최신이 아닙니다. 새로고침 후 다시 시도하세요.'
          : 'History is outdated. Please refresh and try again.'
      );
      return;
    }
  } catch { return; }

  // 현재 커밋 메시지 조회
  const { stdout: currentMsg } = await execGitSilent(
    ['log', '-1', '--format=%B', 'HEAD'], cwd
  );

  // 사이드바 메시지 입력창에 현재 메시지를 세팅하고 커밋 버튼 대기
  const amendLabel = isKo ? '메시지 수정' : 'Amend Message';
  vscode.window.showInformationMessage(
    isKo
      ? `커밋 메시지를 수정한 뒤 [${amendLabel}] 버튼을 누르세요.`
      : `Edit the commit message and press [${amendLabel}].`
  );
  const userMsg = await commitInputProvider.waitForCommit(currentMsg.trim(), amendLabel);
  if (!userMsg || !userMsg.trim()) return;

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
      placeHolder: isKo ? '수정된 커밋의 시간을 선택하세요' : 'Choose the time for the amended commit',
    }
  );
  if (!timeChoice) return;

  try {
    const commitArgs = ['commit', '--amend', '-m', userMsg];
    const env = {};
    if (timeChoice.value === 'original') {
      // amend는 기본적으로 author date를 유지하므로 추가 설정 불필요
    } else {
      // --date 옵션으로 author date를 현재 시간으로 변경
      const now = new Date().toISOString();
      commitArgs.push('--date', now);
      env.GIT_COMMITTER_DATE = now;
    }
    await execGit(commitArgs, cwd, { env: { ...process.env, ...env } });

    commitInputProvider.addHistory(userMsg);
    vscode.window.showInformationMessage(
      isKo ? '커밋 메시지가 수정되었습니다.' : 'Commit message amended.'
    );
  } catch (err) {
    const errMsg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(
      isKo ? `메시지 수정 실패: ${errMsg}` : `Amend failed: ${errMsg}`
    );
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
      { modal: true }, t('yes')
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

  if (remote) {
    try {
      await ensureRemoteBranchFetched(cwd, selectedBranch);
    } catch (err) {
      vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
      return;
    }
  }

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
    confirmMsg, { modal: true, detail: detail + rebaseBackupNote(action) }, actionLabel
  );
  if (confirm !== actionLabel) return;

  const gitArgs = action === 'rebase'
    ? ['rebase', selectedBranch]
    : ['merge', '--no-edit', selectedBranch];
  const gitCmd = `git ${gitArgs.join(' ')}`;

  if (action === 'rebase') {
    await createRebaseBackupIfEnabled(cwd, currentBranch);
  }

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

  const force = pushAction.value === 'force';
  if (force) {
    const confirm = await vscode.window.showWarningMessage(
      t('forcePushConfirm', currentBranch), { modal: true }, t('yes')
    );
    if (confirm !== t('yes')) return;
  }

  await performPush(cwd, currentBranch, force);
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
    // -f로 강제 추가한 ignore 파일도 다시 스테이징되도록 --force 사용
    await execGit(['add', '--force', '--', ...selected.map(s => s.filePath)], cwd);
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
      t('confirmHardReset', commit.hash.substring(0, 8)), { modal: true }, t('yes')
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
    { label: t('copyMessage'), value: 'copyMessage' },
    { label: t('viewDiff'), value: 'diff' },
    { label: t('cherryPickAction'), value: 'cherry-pick' },
    { label: t('resetToHere'), value: 'reset' },
  ];
  const action = await vscode.window.showQuickPick(actionItems, { placeHolder: t('selectHistoryAction') });
  if (!action) return;

  if (action.value === 'copy') {
    await copyShortHash(commit.hash);
    return;
  }

  if (action.value === 'copyMessage') {
    await copyCommitMessage(commit.hash);
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
        t('confirmHardReset', commit.hash.substring(0, 8)), { modal: true }, t('yes')
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

// 변경 파일 목록 표시 위치 설정: 'workspace' = 작업 공간 트리 안(기본) | 'separate' = 별도 뷰
function changesViewMode() {
  return vscode.workspace.getConfiguration('gitReflow').get('changesViewMode', 'workspace');
}

class GitQuickPickTreeProvider {
  // role: 'main' = 작업 공간 트리(히스토리/브랜치/스태시 등), 'changes' = 변경 파일 전용 트리
  constructor(role = 'main') {
    this._role = role;
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
  _remoteBranchCache = null;    // getRemoteBranches 결과 캐시 (refresh 시 무효화)

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
    if (!element) {
      // 변경 사항 전용 트리는 루트에 변경 파일 목록만 표시 (섹션 헤더 없음)
      if (this._role === 'changes') {
        if (!cwd || !await isGitRepo(cwd)) return [];
        return this._getChangedFileItems(cwd, null);
      }
      return this._getRootItems();
    }
    if (!cwd || !await isGitRepo(cwd)) return [];

    switch (element.contextValue) {
      case 'commitSection': return this._getChangedFileItems(cwd, null);
      case 'changedDir': return this._getChangedFileItems(cwd, element.dirPath);
      case 'historySection': return this._getHistoryItems(cwd);
      case 'historyCommitLatest':
      case 'historyCommit': return this._getCommitFileItems(cwd, element);
      case 'localBranchSection': return this._getLocalBranchItems(cwd);
      case 'remoteBranchSection': return this._getRemoteBranchItems(cwd);
      case 'stashSection': return this._getStashItems(cwd);
      case 'stashEntry': return this._getStashFileItems(cwd, element);
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

    // 변경 사항 (작업 공간 모드일 때만 트리 안에 표시; 별도 뷰/인라인 모드면 생략)
    if (changesViewMode() === 'workspace') {
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
    }

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

  async _getHistoryItems(cwd) {
    const commits = await getCommitLog(cwd);
    return commits.map((c, i) => {
      const { label, description } = formatCommitLabel(c);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = description;
      item.tooltip = buildCommitTooltip(c);
      item.iconPath = new vscode.ThemeIcon('git-commit');
      item.contextValue = i === 0 ? 'historyCommitLatest' : 'historyCommit';
      item.commitHash = c.hash;
      return item;
    });
  }

  async _getCommitFileItems(cwd, element) {
    const hash = element.commitHash;
    try {
      // --name-status: 각 파일의 변경 종류(A/M/D)를 함께 가져와 U/D/A로 표시
      // --no-renames: 이름변경을 D+A로 분리해 상태 글자 매핑을 단순화
      const { stdout } = await execGit(
        ['diff-tree', '--no-commit-id', '-r', '--no-renames', '--name-status', hash], cwd
      );
      return parseNameStatus(stdout).map(({ statusCode, filePath: f }) => {
        const letter = fileStatusLetter(statusCode);
        const dir = path.dirname(f);
        const item = new vscode.TreeItem(
          path.basename(f),
          vscode.TreeItemCollapsibleState.None
        );
        item.description = dir === '.' ? letter : `${letter}  ${dir}`;
        item.iconPath = vscode.ThemeIcon.File;
        item.contextValue = 'historyFile';
        item.tooltip = f;
        item.commitHash = hash;
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
    // 현재 브랜치를 항상 맨 위에 노출한다 (나머지는 기존 커밋 날짜 순서 유지)
    branches.sort((a, b) => {
      if (a.name === currentBranch) return -1;
      if (b.name === currentBranch) return 1;
      return 0;
    });
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
    // fetch / ls-remote 는 수동 새로고침(refreshView) 또는 섹션 재펼침 시에만 실행
    if (this._remoteFetchRequested) {
      this._remoteFetchRequested = false;
      this._remoteBranchCache = null;
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: t('fetchingRemotes') },
          () => fetchAll(cwd)
        );
      } catch (err) {
        // 인증 취소/실패 → 로컬 추적 refs 로 폴백. 재시도는 collapse 후 re-expand 로.
        outputChannel.appendLine(`[WARN] fetch --all failed: ${err.message || err}`);
      }
    }
    if (!this._remoteBranchCache) {
      this._remoteBranchCache = await getRemoteBranches(cwd);
    }
    const branches = this._remoteBranchCache;
    return branches.map(b => {
      const item = new vscode.TreeItem(b.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(b.unfetched ? 'cloud-download' : 'cloud');
      item.description = b.description;
      item.contextValue = 'remoteBranch';
      item.branchName = b.name;
      item.unfetched = !!b.unfetched;
      return item;
    });
  }

  async _getBranchHistoryItems(cwd, parentItem) {
    if (parentItem.unfetched) {
      try {
        await ensureRemoteBranchFetched(cwd, parentItem.branchName);
        parentItem.unfetched = false;
      } catch (err) {
        vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
        return [];
      }
    }
    const commits = await getCommitLog(cwd, { branch: parentItem.branchName });
    return commits.map(c => {
      const { label, description } = formatCommitLabel(c);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = description;
      item.tooltip = buildCommitTooltip(c);
      item.iconPath = new vscode.ThemeIcon('git-commit');
      item.contextValue = 'branchHistoryCommit';
      item.commitHash = c.hash;
      return item;
    });
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

  // 커밋 메시지 WebviewView 등록
  const commitInputProvider = new CommitInputViewProvider(context.globalState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('gitQuickPickCommitInput', commitInputProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Sidebar TreeView 등록
  const treeProvider = new GitQuickPickTreeProvider('main');
  const treeView = vscode.window.createTreeView('gitQuickPickView', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
    manageCheckboxStateManually: true,
  });
  context.subscriptions.push(treeView);

  // 변경 사항 전용 TreeView (설정 ON 시 커밋 버튼 바로 아래에 표시)
  const changesProvider = new GitQuickPickTreeProvider('changes');
  const changesView = vscode.window.createTreeView('gitQuickPickChanges', {
    treeDataProvider: changesProvider,
    showCollapseAll: false,
    manageCheckboxStateManually: true,
  });
  context.subscriptions.push(changesView);

  // 변경 사항(체크박스/커밋)을 다루는 현재 활성 provider — 별도 뷰 모드면 별도 트리, 아니면 작업 공간 트리
  const activeChangesProvider = () => (changesViewMode() === 'separate' ? changesProvider : treeProvider);

  // 별도 뷰 모드일 때 변경 파일 트리도 함께 갱신
  async function syncChangesHost() {
    if (changesViewMode() === 'separate') await changesProvider.updateStatus();
  }


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
    changesView.description = treeProvider._changeCount > 0 ? t('changes', treeProvider._changeCount) : '';
    commitInputProvider.setBranchDescription(desc);
  }

  // updateStatus 후 타이틀 + 컨텍스트 갱신
  const origUpdateStatus = treeProvider.updateStatus.bind(treeProvider);
  function updateCheckedFilesContext() {
    const host = activeChangesProvider();
    const hasChecked = [...host._checkedFiles.values()].some(v => v);
    vscode.commands.executeCommand('setContext', 'gitReflow.hasCheckedFiles', hasChecked);
  }

  treeProvider.updateStatus = async function () {
    await origUpdateStatus();
    await syncChangesHost();
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
  context.subscriptions.push(
    changesView.onDidChangeVisibility(e => {
      // 래퍼(treeProvider.updateStatus)가 변경사항 트리 갱신 + 컨텍스트까지 함께 처리
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
      } else if (['historySection', 'localBranchSection', 'remoteBranchSection', 'stashSection'].includes(ctx)) {
        treeProvider.refresh(e.element);
      }
    })
  );
  context.subscriptions.push(
    treeView.onDidCollapseElement(e => {
      const ctx = e.element.contextValue;
      treeProvider._expandedSections.delete(ctx);
      // 원격 섹션을 접으면 재펼침 시 fetch + ls-remote 재시도 (인증 취소/실패 후 재시도 경로)
      if (ctx === 'remoteBranchSection') {
        treeProvider._remoteFetchRequested = true;
        treeProvider._remoteBranchCache = null;
      }
      // 개별 미페치 원격 브랜치를 접으면 빈 자식 캐시 무효화 → 재펼침 시 ensureRemoteBranchFetched 재실행
      if (ctx === 'remoteBranch' && e.element.unfetched) {
        treeProvider.refresh(e.element);
      }
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
  context.subscriptions.push(
    changesView.onDidChangeCheckboxState(e => handleCheckboxChange(changesProvider, e))
  );

  // 파일 저장 시 상태 갱신
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => treeProvider.updateStatus())
  );

  // 커밋 표시 순서 / 변경사항 분리 설정이 바뀌면 트리뷰를 새로고침해 즉시 반영
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitReflow.commitFieldOrder')) treeProvider.refresh();
      if (e.affectsConfiguration('gitReflow.changesViewMode')) fullRefresh();
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
        lastBlameKey = '';
        scheduleBlameUpdate(editor);
      }
    })
  );
  // 파일 저장 시 blame 캐시 초기화 후 갱신
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      lastBlameKey = '';
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
    await syncChangesHost();
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
    'gitReflow.openDeletedFileDiff': (filePath) => openDeletedFileDiff(filePath),
    'gitReflow.openCommitFileDiff': (hash, filePath, cwd) => openCommitFileDiff(hash, filePath, cwd),
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
  if (blameTimeout) clearTimeout(blameTimeout);
  blameDecorationType.dispose();
}

module.exports = { activate, deactivate };

// Test-only internals — i18n 테스트용. 순수 헬퍼는 lib/git-helpers.js에서 직접 import.
// 런타임 의존하지 말 것
module.exports._internals = { t, getCurrentBranch, fileStatusLetter };
