'use strict';

// ─────────────────────────────────────────────────────────────────────
// i18n — 한/영 메시지 사전 + t() 치환 함수
// 언어: gitReflow.language 설정 (auto/ko/en). auto 면 OS/VS Code 로케일.
// 로드 시점에 한 번 해석한다(설정 변경 시 창 새로고침 필요) — 다른 모듈은 require('./i18n').
// ─────────────────────────────────────────────────────────────────────

const vscode = require('vscode');

function resolveIsKo() {
  let lang = 'auto';
  try {
    lang = vscode.workspace.getConfiguration('gitReflow').get('language', 'auto') || 'auto';
  } catch { /* 설정 접근 불가 시 auto 폴백 */ }
  if (lang === 'ko') return true;
  if (lang === 'en') return false;
  return (vscode.env.language || 'en').startsWith('ko'); // auto: OS 로케일
}

const isKo = resolveIsKo();

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
  // ─── Webview 우클릭 메뉴 라벨 (master 명령 제목과 동일) ──
  mCopyHash:          ['해시 복사', 'Copy Hash'],
  mCopyMessage:       ['메시지 복사', 'Copy Message'],
  mAmend:             ['커밋 메시지 수정', 'Edit Commit Message'],
  mSquash:            ['여기서부터 커밋 합치기', 'Squash Commits from Here'],
  mSoftReset:         ['소프트 리셋', 'Soft Reset'],
  mHardReset:         ['하드 리셋', 'Hard Reset'],
  mCherryPick:        ['체리픽', 'Cherry Pick'],
  mSwitch:            ['브랜치 전환', 'Switch Branch'],
  mBranchPull:        ['원격에서 풀', 'Pull from Remote'],
  mForceBranchPull:   ['원격에서 강제 풀', 'Force Pull from Remote'],
  mRebase:            ['현재 브랜치를 여기 위에 Rebase (onto)', 'Rebase current onto this'],
  mMerge:             ['현재 브랜치에 Merge (into)', 'Merge this into current'],
  mDeleteBranch:      ['브랜치 삭제', 'Delete Branch'],
  mDeleteRemoteBranch:['원격 브랜치 삭제', 'Delete Remote Branch'],
  mCreateBranch:      ['브랜치 생성', 'Create Branch'],
  mFileOpen:          ['열기', 'Open'],
  mFileCompare:       ['로컬과 비교', 'Compare with Local'],
  mFileDiff:          ['변경 비교', 'Compare Changes'],
  // ─── 변경/스태시 webview 메뉴 라벨 (트리 명령 제목과 동일) ──
  mJumpToSource:      ['소스로 이동', 'Go to Source'],
  mStageFile:         ['스테이지에 추가', 'Stage'],
  mRollbackFile:      ['변경 되돌리기', 'Discard Changes'],
  mDeleteFile:        ['파일 삭제', 'Delete File'],
  mAddGitignore:      ['.gitignore에 추가', 'Add to .gitignore'],
  mCopyPath:          ['경로 복사', 'Copy Path'],
  mCopyRelPath:       ['상대 경로 복사', 'Copy Relative Path'],
  mOpenConflictMerge: ['Merge Editor에서 충돌 해결', 'Resolve in Merge Editor'],
  mOpenConflictEditor:['에디터에서 열기 (충돌 마커)', 'Open in Editor (markers)'],
  mCreateStash:       ['변경 사항 스태시', 'Stash Changes'],
  mStashPop:          ['복구 후 삭제 (pop)', 'Pop (restore & drop)'],
  mStashApply:        ['복구 후 보존 (apply)', 'Apply (restore & keep)'],
  mStashDrop:         ['스태시 삭제', 'Drop Stash'],
  selectAll:          ['전체 선택/해제', 'Select All'],
  noStash:            ['스태시가 없습니다.', 'No stashes.'],
  toggleFileView:     ['파일/트리 보기 전환', 'Toggle file/tree view'],
  forcePull:          ['Force Pull', 'Force Pull'],
  wvRefresh:          ['새로고침', 'Refresh'],
  wvSettings:         ['설정', 'Settings'],
  wvCleanup:          ['백업 정리', 'Clean up backups'],
  inputPlaceholder:   ['커밋 메시지 (Ctrl+Enter로 커밋)', 'Commit message (Ctrl+Enter to commit)'],
  inputCommit:        ['커밋', 'Commit'],
  inputCommitDefault: ['✓ 커밋', '✓ Commit'],
  inputRecent:        ['최근 메시지', 'Recent messages'],
  noCommitHistory:    ['커밋 메시지 히스토리가 없습니다', 'No commit message history'],
  selectRecentMsg:    ['최근 커밋 메시지 선택', 'Select recent commit message'],
  reloadForLanguage:  ['언어 설정을 적용하려면 창을 새로고침하세요.', 'Reload the window to apply the language setting.'],
  reloadWindow:       ['창 새로고침', 'Reload Window'],
};

function t(key, ...args) {
  const msg = messages[key];
  if (!msg) return key;
  const text = isKo ? msg[0] : msg[1];
  return args.length
    ? text.replace(/\{(\d)\}/g, (_, i) => args[i] ?? '')
    : text;
}

module.exports = { isKo, messages, t };
