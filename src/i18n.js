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
  backupPruned: [
    '오래된 백업 브랜치 {0}개를 자동 정리했습니다.',
    'Automatically pruned {0} old backup branch(es).'
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
  // rebaseOnto 는 위(28행)에 정의됨. mergeInto 는 확인 버튼 라벨.
  mergeInto:        ['{0}에 머지', 'Merge into {0}'],
  yes:              ['예', 'Yes'],
  cancel:           ['취소', 'Cancel'],
  pull:             ['Pull', 'Pull'],
  pullRebase:       ['Pull --rebase', 'Pull --rebase'],
  resolveInEditor:  ['에디터에서 해결', 'Resolve in Editor'],
  abortRebase:        ['리베이스 취소', 'Abort Rebase'],
  continueRebase:     ['리베이스 계속', 'Continue Rebase'],
  abortMerge:         ['병합 취소', 'Abort Merge'],
  continueMerge:      ['병합 완료', 'Complete Merge'],
  abortCherryPick:    ['체리픽 취소', 'Abort Cherry-pick'],
  continueCherryPick: ['체리픽 계속', 'Continue Cherry-pick'],
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
  pushLease:          ['안전 강제 푸시', 'Force Push (with lease)'],
  pushLeaseHint:      [
    '원격이 그대로일 때만 덮어씀',
    'Overwrites only if the remote is unchanged'
  ],
  pushSuccess:        ['{0} 브랜치 푸시 완료', 'Pushed branch {0}'],
  pullAnyway:         ['그래도 Pull', 'Pull anyway'],
  divergedPullWarn:   [
    '로컬과 원격의 히스토리가 갈라져 있습니다.\n(로컬에만 있는 커밋 {0}개 / 원격에만 있는 커밋 {1}개)',
    'Local and remote histories have diverged.\n({0} commit(s) only local / {1} commit(s) only on remote)'
  ],
  divergedPullDetail: [
    '커밋 메시지 수정, rebase, squash 등으로 히스토리를 다시 쓰면 이 상태가 됩니다.\n\n' +
    '지금 Pull 하면 원격에 남아 있는 예전 커밋이 다시 들어와, ' +
    '같은 작업이 두 벌 들어간 히스토리가 만들어집니다.\n\n' +
    '히스토리를 다시 쓴 것이 맞다면 Pull 이 아니라 [안전 강제 푸시]로 올리세요.',
    'Rewriting history (editing a commit message, rebase, squash, …) leaves the branch in this state.\n\n' +
    'Pulling now brings the old commits back from the remote, ' +
    'leaving you with the same work twice in your history.\n\n' +
    'If you did rewrite history, push with [Force Push (with lease)] instead of pulling.'
  ],
  forcePushConfirm:   ['{0} 브랜치를 Force Push합니까? 원격 히스토리가 덮어씌워집니다.', 'Force push {0}? This will overwrite remote history.'],
  leasePushConfirm:   [
    '{0} 브랜치를 안전 강제 푸시합니까?\n\n' +
    '원격이 마지막으로 받아둔 상태 그대로일 때만 덮어씁니다. ' +
    '다른 사람이 그 사이에 푸시했다면 거부되므로, 남의 커밋을 지울 위험이 없습니다.',
    'Force push {0} with lease?\n\n' +
    'Overwrites the remote only if it still matches what you last fetched. ' +
    'If someone else pushed in the meantime it is rejected, so no one else\'s commits are lost.'
  ],
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
  viewDiff:           ['📄 diff 보기', '📄 View diff'],
  local:              ['로컬', 'Local'],
  cherryPickAction:   ['🍒 체리픽', '🍒 Cherry pick'],
  resetToHere:        ['⏪ 여기로 리셋', '⏪ Reset to here'],
  hashCopied:         ['해시가 클립보드에 복사되었습니다: {0}', 'Hash copied to clipboard: {0}'],
  messageCopied:      ['메시지가 클립보드에 복사되었습니다.', 'Commit message copied to clipboard.'],
  branchNameCopied:   ['브랜치명이 클립보드에 복사되었습니다: {0}', 'Branch name copied to clipboard: {0}'],
  copyBranchNameHint: ['클릭하여 브랜치명 복사', 'Click to copy branch name'],
  remoteUrlCopied:    ['git 주소가 클립보드에 복사되었습니다: {0}', 'Git URL copied to clipboard: {0}'],
  remoteUrlNotFound:  ['원격 {0} 의 git 주소를 찾을 수 없습니다', 'Could not find git URL for remote {0}'],
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
  branchPrefixHint:   ['접두어를 고르면 뒤에 이슈번호를 입력하세요 (예: f → feature/ → feature/1234)',
                       'Pick a prefix, then type the issue number (e.g. f → feature/ → feature/1234)'],
  branchCreateThis:   ['이 이름으로 브랜치 생성', 'Create branch with this name'],
  branchPrefixKey:    ['Enter 로 채우기', 'Enter to fill in'],
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
  authFailed:         ['Git 인증 실패 ({0}): 자격 증명을 확인하세요.', 'Git authentication failed ({0}): check your credentials.'],
  openOutput:         ['출력 채널 열기', 'Open Output'],
  hookFailedPrefix:   [
    '⚠️ 커밋 훅(pre-commit) 실패 — 아래 로그를 확인하세요. (건너뛰려면 --no-verify)',
    '⚠️ Commit hook (pre-commit) failed — check the log below. (use --no-verify to skip)'
  ],
  statusHookFailed:   ['$(error) 커밋 훅 실패', '$(error) Commit hook failed'],
  statusGitFailed:    ['$(error) Git 실패', '$(error) Git failed'],
  authUsername:       ['{0} 사용자 이름', 'Username for {0}'],
  authPassword:       ['{0}@{1} 비밀번호', 'Password for {0}@{1}'],
  authRequired:       ['{0} 인증이 필요합니다', 'Authentication required for {0}'],
  authCancelled:      ['인증이 취소되었습니다.', 'Authentication cancelled.'],
  // ─── Squash / Amend ────────────────────────────────────
  squashNeedTwo:      ['합칠 커밋이 2개 이상이어야 합니다.', 'Need at least 2 commits to squash.'],
  squashLabel:        ['커밋 합치기', 'Squash Commits'],
  squashPrompt:       [
    '{0}개 커밋을 합칩니다. 메시지를 수정한 뒤 [{1}] 버튼을 누르세요.',
    'Squashing {0} commits. Edit the message and press [{1}].'
  ],
  squashPlaceholder:  ['합쳐진 커밋의 시간을 선택하세요', 'Choose the time for the squashed commit'],
  squashDone:         ['{0}개 커밋이 합쳐졌습니다.', '{0} commits squashed.'],
  squashFailed:       ['커밋 합치기 실패: {0}', 'Squash failed: {0}'],
  amendLabel:         ['메시지 수정', 'Amend Message'],
  amendOutdated:      [
    '히스토리가 최신이 아닙니다. 새로고침 후 다시 시도하세요.',
    'History is outdated. Please refresh and try again.'
  ],
  amendPrompt:        [
    '커밋 메시지를 수정한 뒤 [{0}] 버튼을 누르세요.',
    'Edit the commit message and press [{0}].'
  ],
  amendPlaceholder:   ['수정된 커밋의 시간을 선택하세요', 'Choose the time for the amended commit'],
  amendDone:          ['커밋 메시지가 수정되었습니다.', 'Commit message amended.'],
  amendFailed:        ['메시지 수정 실패: {0}', 'Amend failed: {0}'],
  // ─── 과거 커밋 메시지 수정 (reword) ─────────────────────
  confirmReword:      [
    '과거 커밋 {0} 의 메시지를 수정합니다. 계속할까요?',
    'Edit the message of older commit {0}. Continue?'
  ],
  rewordDetail:       [
    '이 커밋 이후의 커밋 {0}개는 내용은 그대로지만 해시가 새로 만들어집니다.',
    'The {0} commit(s) after it keep their content but get new hashes.'
  ],
  rewordBackupNote:   [
    '시작 전에 복구용 백업 브랜치(backup/...)가 자동으로 만들어집니다.',
    'A backup branch (backup/...) will be created before starting.'
  ],
  rewordPushedWarn:   [
    '⚠ 이 커밋은 이미 원격에 올라가 있어, 다른 사람이 받아갔을 수 있습니다. ' +
    '수정 후에는 [안전 강제 푸시]로 올리세요.',
    '⚠ This commit is already on the remote, so others may have pulled it. ' +
    'After editing, push it with [Force Push (with lease)].'
  ],
  rewordPreRebaseHook: [
    'ℹ 이 저장소에는 pre-rebase 훅이 있습니다. 훅이 거부하면 메시지는 수정되지 않고 중단됩니다 ' +
    '(저장소는 그대로 유지됩니다).',
    'ℹ This repository has a pre-rebase hook. If it rejects the rebase, the message is left ' +
    'unchanged and nothing is modified.'
  ],
  rewordHasMerge:     [
    '이 커밋 이후에 머지 커밋이 있어 메시지를 수정할 수 없습니다. ' +
    '(머지를 다시 수행하면 과거에 해결한 충돌 결과가 바뀔 수 있습니다)',
    'Cannot edit: there is a merge commit after this one. '
    + '(Redoing the merge could change previously resolved conflicts.)'
  ],
  rewordAbortFailed:  [
    'rebase 중단(--abort)까지 실패했습니다. 저장소가 rebase 진행 중 상태로 남아 있습니다. ' +
    '터미널에서 `git rebase --abort` 를 실행하거나 backup/... 브랜치로 복구하세요.',
    'Failed to abort the rebase. The repository is left mid-rebase. ' +
    'Run `git rebase --abort` in a terminal, or restore from the backup/... branch.'
  ],
  rewordDetached:     [
    'detached HEAD 상태에서는 과거 커밋 메시지를 수정할 수 없습니다. 브랜치로 전환하세요.',
    'Cannot edit an older commit message in detached HEAD. Switch to a branch first.'
  ],
  rewordInProgress:   [
    '진행 중인 rebase/merge 작업이 있어 과거 커밋 메시지를 수정할 수 없습니다.',
    'Cannot edit an older commit message while a rebase/merge is in progress.'
  ],
  rewordNotOnBranch:  [
    '현재 브랜치에 포함된 커밋이 아니어서 메시지를 수정할 수 없습니다.',
    'This commit is not on the current branch, so its message cannot be edited.'
  ],
  commitTimeTitle:    ['커밋 시간 선택', 'Commit time'],
  commitTimeKeep:     ['원래 커밋 시간 유지', 'Keep original commit time'],
  commitTimeNow:      ['현재 시간 사용', 'Use current time'],
  // ─── 커밋 안 된 변경 자동 stash 확인 ───────────────────
  stashDirtyTitle:    [
    '커밋하지 않은 변경이 있습니다. 잠시 보관하고 진행할까요?',
    'You have uncommitted changes. Stash them temporarily and continue?'
  ],
  stashDirtyDetail:   [
    '이 변경이 지금 작업(합치기/메시지 수정)에 섞이지 않도록 임시로 stash 했다가, ' +
    '작업이 끝나면 자동으로 되돌립니다.\n\n' +
    '취소하면 아무 작업도 하지 않습니다.',
    'Your changes are stashed temporarily so they are not mixed into this operation ' +
    '(squash / amend), then restored automatically when it finishes.\n\n' +
    'If you cancel, nothing is done.'
  ],
  stashDirtyProceed:  ['보관 후 진행', 'Stash & continue'],
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
  mCopyBranchName:    ['브랜치명 복사', 'Copy Branch Name'],
  mCopyRemoteUrl:     ['git 주소 복사', 'Copy Git URL'],
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
  mAcceptMerge:       ['병합 완료', 'Accept Merge'],
  acceptMergeHint:    ['병합을 완료하려면 ✔ 누르세요', 'Click ✔ to accept merge'],
  mCreateStash:       ['변경 사항 스태시', 'Stash Changes'],
  mStashPop:          ['복구 후 삭제 (pop)', 'Pop (restore & drop)'],
  mStashApply:        ['복구 후 보존 (apply)', 'Apply (restore & keep)'],
  mStashDrop:         ['스태시 삭제', 'Drop Stash'],
  selectAll:          ['전체 선택/해제', 'Select All'],
  selectedCountHint:  ['선택된 파일 수', 'Selected files'],
  noStash:            ['스태시가 없습니다.', 'No stashes.'],
  toggleFileView:     ['파일/트리 보기 전환', 'Toggle file/tree view'],
  inputPlaceholder:   ['커밋 메시지 (Ctrl+Enter로 커밋)', 'Commit message (Ctrl+Enter to commit)'],
  inputCommit:        ['커밋', 'Commit'],
  inputCommitDefault: ['✓ 커밋', '✓ Commit'],
  inputRecent:        ['최근 메시지', 'Recent messages'],
  inputHookRun:       ['Hook 실행', 'Run hooks'],
  noCommitHistory:    ['커밋 메시지 히스토리가 없습니다', 'No commit message history'],
  selectRecentMsg:    ['최근 커밋 메시지 선택', 'Select recent commit message'],
  reloadForLanguage:  ['언어 설정을 적용하려면 창을 새로고침하세요.', 'Reload the window to apply the language setting.'],
  reloadWindow:       ['창 새로고침', 'Reload Window'],
  loadMore:           ['더 불러오기', 'Load more'],
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
