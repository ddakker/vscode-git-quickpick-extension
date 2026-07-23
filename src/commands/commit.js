'use strict';

// 커밋 명령 — 사이드바 커밋 / squash / amend (커밋 입력 뷰 인스턴스를 주입받음).

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { getCurrentBranch, isDetachedHead, hasInProgressOperation } = require('../git/queries');
const {
  createRebaseBackupIfEnabled, isRebaseBackupEnabled, deleteBackupBranches,
} = require('../features/backup');
const { showGitError } = require('./error');
const { formatGitError } = require('../../lib/git-helpers');

// 커밋 시간 선택 QuickPick — squash/amend 공통. 취소 시 undefined 반환.
function pickCommitTime(placeHolder) {
  return vscode.window.showQuickPick(
    [
      { label: t('commitTimeKeep'), value: 'original' },
      { label: t('commitTimeNow'), value: 'now' },
    ],
    { title: t('commitTimeTitle'), placeHolder }
  );
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

  const noVerify = commitInputProvider.getNoVerify();

  try {
    try {
      await execGit(['reset', 'HEAD'], cwd);
    } catch {
      // initial commit: no HEAD yet
    }
    // 사용자가 -f로 강제 추가한 ignore 파일도 다시 스테이징되도록 --force 사용
    await execGit(['add', '--force', '--', ...checkedFiles], cwd);
    const commitArgs = ['commit', '-m', commitMessage];
    if (noVerify) commitArgs.push('--no-verify');
    await execGit(commitArgs, cwd);
    vscode.window.showInformationMessage(t('commitSuccess', commitMessage));
    commitInputProvider.addHistory(commitMessage);
    commitInputProvider.clearMessage();
    commitInputProvider.resetNoVerify();
  } catch (err) {
    await showGitError(err);
  }
}

// 커밋 안 된 변경(스테이징 포함, untracked 제외)이 있는지 확인.
// untracked 파일은 squash/amend 커밋에 섞이지 않고 stash 로도 안 옮겨지므로 제외한다.
async function hasUncommittedChanges(cwd) {
  try {
    const { stdout } = await execGitSilent(['diff', '--stat'], cwd);
    const { stdout: staged } = await execGitSilent(['diff', '--cached', '--stat'], cwd);
    return stdout.trim() !== '' || staged.trim() !== '';
  } catch {
    return false;
  }
}

// 커밋 안 된 변경이 있으면 먼저 사용자에게 확인받는다(실제 stash 는 작업 직전에 한다).
// 확인창을 맨 앞에 두어, 메시지 입력·시간 선택 전에 진행 여부부터 묻는다.
// 반환: proceed=false 면 사용자가 취소한 것이므로 호출자는 아무것도 하지 말고 중단한다.
async function confirmStashDirty(cwd) {
  if (!await hasUncommittedChanges(cwd)) return { proceed: true };

  const proceedLabel = t('stashDirtyProceed');
  const answer = await vscode.window.showWarningMessage(
    t('stashDirtyTitle'), { modal: true, detail: t('stashDirtyDetail') }, proceedLabel
  );
  return { proceed: answer === proceedLabel };
}

// 작업 직전에 커밋 안 된 변경을 임시로 stash 한다.
// 확인 시점엔 깨끗했더라도 메시지 입력을 기다리는 동안 새로 생긴 변경이 재작성 커밋에
// 섞이면 안 되므로, 앞 단계의 플래그가 아니라 '지금' 상태를 다시 확인해 판단한다.
// 반환: stashed=true 면 작업 후 stash pop 으로 되돌려야 한다.
async function stashDirtyIfNeeded(cwd) {
  if (!await hasUncommittedChanges(cwd)) return false;
  await execGit(['stash', 'push', '-m', 'auto-stash before rewrite'], cwd);
  return true;
}

// 임시로 stash 한 변경을 되돌린다. pop 실패는 무시한다(사용자가 직접 복구).
async function restoreStashIfNeeded(cwd, stashed) {
  if (!stashed) return;
  try { await execGit(['stash', 'pop'], cwd); } catch { /* ignore */ }
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
    vscode.window.showWarningMessage(t('squashNeedTwo'));
    return;
  }

  // 커밋 안 된 변경이 squash 커밋에 섞이지 않도록, 메시지 입력 전에 먼저 확인받는다.
  const { proceed } = await confirmStashDirty(cwd);
  if (!proceed) return;

  // 커밋 메시지 목록을 기본값으로 제공
  const messages = commits.map((line) => line.substring(line.indexOf(' ') + 1));
  const defaultMsg = messages.join('\n');

  // 사이드바 메시지 입력창에 기존 메시지를 세팅하고 커밋 버튼 대기
  const squashLabel = t('squashLabel');
  vscode.window.showInformationMessage(t('squashPrompt', commits.length, squashLabel));
  const userMsg = await commitInputProvider.waitForCommit(defaultMsg, squashLabel);
  if (!userMsg || !userMsg.trim()) return;

  // 커밋 시간 옵션
  const timeChoice = await pickCommitTime(t('squashPlaceholder'));
  if (!timeChoice) return;

  // 확인받은 변경을 실제 작업 직전에 임시 stash
  const stashed = await stashDirtyIfNeeded(cwd);

  try {
    // 원래 커밋의 author date 조회 (가장 오래된 커밋 기준)
    const { stdout: dateOut } = await execGitSilent(
      ['log', '-1', '--format=%aI', hash], cwd
    );
    const originalDate = dateOut.trim();

    // soft reset으로 커밋 내용은 유지하면서 커밋 이력만 제거
    await execGit(['reset', '--soft', `${hash}~1`], cwd);

    // 커밋 생성 — 이미 커밋된 내용을 재조합하는 것이므로 훅은 건너뛴다
    const commitArgs = ['commit', '-m', userMsg, '--no-verify'];
    const env = {};
    if (timeChoice.value === 'original') {
      env.GIT_AUTHOR_DATE = originalDate;
      env.GIT_COMMITTER_DATE = originalDate;
    }
    await execGit(commitArgs, cwd, { env });

    commitInputProvider.addHistory(userMsg);
    vscode.window.showInformationMessage(t('squashDone', commits.length));
  } catch (err) {
    vscode.window.showErrorMessage(t('squashFailed', formatGitError(err)));
  } finally {
    await restoreStashIfNeeded(cwd, stashed);
  }
}

// HEAD 커밋의 메시지 수정 — 이후 커밋이 없으므로 --amend 로 끝난다.
async function amendHeadMessage(cwd, message, useNow) {
  // 메시지만 수정하는 것이므로 훅은 건너뛴다
  const commitArgs = ['commit', '--amend', '-m', message, '--no-verify'];
  const env = {};
  // amend 는 기본적으로 author date 를 유지하므로 '원래 시간 유지'에는 추가 설정이 필요 없다.
  if (useNow) {
    const now = new Date().toISOString();
    commitArgs.push('--date', now);
    env.GIT_COMMITTER_DATE = now;
  }
  await execGit(commitArgs, cwd, { env });
}

// hash..HEAD 구간에 머지 커밋이 있는지 확인.
// 머지 커밋을 rebase 로 옮기면 머지가 재수행되어, 원래 머지에서 수동으로 해결한 충돌 결과가
// 재현되지 않는다(내용이 조용히 바뀔 수 있다). 그래서 이 경우는 아예 막는다.
async function hasMergeCommitsAfter(cwd, hash) {
  try {
    const { stdout } = await execGitSilent(['rev-list', '--merges', `${hash}..HEAD`], cwd);
    return stdout.trim() !== '';
  } catch {
    return false;
  }
}

// hash..HEAD 구간의 커밋 개수 = 메시지 수정으로 해시가 재작성될 커밋 수.
async function countCommitsAfter(cwd, hash) {
  try {
    const { stdout } = await execGitSilent(['rev-list', '--count', `${hash}..HEAD`], cwd);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// 저장소가 커밋 서명(commit.gpgsign)을 쓰는지 확인.
// commit --amend 는 이 설정을 알아서 따르지만, 저수준 명령인 commit-tree 는 따르지 않는다.
// 그래서 reword 에서는 직접 확인해 -S 를 붙여야 서명이 사라지지 않는다.
async function isGpgSignEnabled(cwd) {
  try {
    const { stdout } = await execGitSilent(['config', '--get', 'commit.gpgsign'], cwd);
    return stdout.trim() === 'true';
  } catch {
    return false;   // 설정이 없으면 서명하지 않는 저장소다
  }
}

// pre-rebase 훅이 설치돼 있는지 확인.
// 이 훅은 rebase 를 막으려고 두는 것이므로(예: 이미 push 된 브랜치의 rebase 금지),
// 우회하지 않고 그대로 존중한다. 다만 거부당하면 메시지를 다 입력한 뒤에야 실패하므로,
// 훅이 있으면 시작 전에 미리 알려 헛수고를 줄인다.
// git 의 거부 메시지는 로케일에 따라 번역되므로 stderr 문자열로 판별하지 않고 훅 존재로 판단한다.
async function hasPreRebaseHook(cwd) {
  try {
    // core.hooksPath 로 훅 경로를 바꾼 저장소도 있으므로 git 에게 직접 물어본다.
    const { stdout } = await execGitSilent(['rev-parse', '--git-path', 'hooks/pre-rebase'], cwd);
    return fs.existsSync(path.resolve(cwd, stdout.trim()));
  } catch {
    return false;
  }
}

// 커밋이 원격 브랜치에 이미 포함돼 있는지 확인.
// 이미 push 된 커밋을 재작성하면 이후 push 가 거부되어 force push 가 필요해진다.
async function isPushedCommit(cwd, hash) {
  try {
    const { stdout } = await execGitSilent(['branch', '-r', '--contains', hash], cwd);
    return stdout.trim() !== '';
  } catch {
    return false;
  }
}

// 과거 커밋(HEAD 아님)의 메시지 수정.
// 파일 내용(tree)은 그대로 두고 메시지만 바꾼 새 커밋을 commit-tree 로 만든 뒤,
// 그 위로 이후 커밋들을 rebase --onto 로 재적용한다.
// 재적용 구간에 머지 커밋이 없음은 checkRewordable 에서 보장되므로(머지가 있으면 차단),
// 각 커밋은 부모가 하나뿐인 단순 패치이고 tree 도 원본과 같아 충돌이 발생하지 않는다.
async function rewordHistoryCommit(cwd, hash, message, useNow) {
  // 원본 커밋의 tree / 부모 / author 정보 (author 는 그대로 보존해야 한다)
  const { stdout: info } = await execGitSilent(
    ['log', '-1', '--format=%T%n%P%n%an%n%ae%n%aI', hash], cwd
  );
  const [tree, parents, authorName, authorEmail, authorDate] = info.split('\n');

  // 서명을 쓰는 저장소인지 — 저수준 명령인 commit-tree 는 commit.gpgsign 을 무시하므로
  // -S 를 직접 붙여야 이 커밋만 서명이 빠지는 일이 없다.
  // (rebase 는 commit.gpgsign 을 따르지만, 의도를 드러내려고 여기서도 -S 를 명시한다)
  const sign = await isGpgSignEnabled(cwd);

  // 메시지만 바꾼 새 커밋 생성 — commit-tree 는 훅을 실행하지 않는다.
  const treeArgs = ['commit-tree', tree.trim()];
  for (const parent of parents.trim().split(/\s+/).filter(Boolean)) {
    treeArgs.push('-p', parent);
  }
  if (sign) treeArgs.push('-S');
  treeArgs.push('-m', message);

  const env = {
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_AUTHOR_DATE: useNow ? new Date().toISOString() : authorDate,
  };
  const { stdout: newHashOut } = await execGit(treeArgs, cwd, { env });
  const newHash = newHashOut.trim();

  // 이후 커밋들을 새 커밋 위로 옮긴다. 실패하면 rebase 를 중단해 원래 상태로 되돌린다.
  const rebaseArgs = ['rebase', '--autostash'];
  if (sign) rebaseArgs.push('-S');
  rebaseArgs.push('--onto', newHash, hash);
  try {
    await execGit(rebaseArgs, cwd);
  } catch (err) {
    try {
      await execGitSilent(['rebase', '--abort'], cwd);
    } catch {
      // abort 까지 실패하면 저장소가 rebase 진행 중 상태로 남는다.
      // 사용자가 스스로 복구할 수 있도록 백업 브랜치 이름과 함께 상황을 알린다.
      vscode.window.showErrorMessage(t('rewordAbortFailed'));
    }
    throw err;
  }
}

// 과거 커밋 메시지를 수정할 수 있는 상태인지 확인. 불가하면 사유 메시지를, 가능하면 null 을 반환.
async function checkRewordable(cwd, hash) {
  if (await isDetachedHead(cwd)) return t('rewordDetached');
  if (await hasInProgressOperation(cwd)) return t('rewordInProgress');

  // 현재 브랜치의 조상이 아닌 커밋(다른 브랜치의 커밋)은 재작성 대상이 아니다.
  try {
    await execGitSilent(['merge-base', '--is-ancestor', hash, 'HEAD'], cwd);
  } catch {
    return t('rewordNotOnBranch');
  }

  // 이후 구간에 머지 커밋이 있으면 재적용 과정에서 머지가 재수행되어 내용이 바뀔 수 있다.
  if (await hasMergeCommitsAfter(cwd, hash)) return t('rewordHasMerge');

  return null;
}

// 히스토리 재작성 전 확인 모달. 진행하면 true.
// 재작성될 커밋 수와 백업 브랜치 생성 여부를 알리고, 이미 push 된 커밋이면 경고를 덧붙인다.
async function confirmReword(cwd, hash) {
  const rewritten = await countCommitsAfter(cwd, hash);

  const notes = [t('rewordDetail', rewritten)];
  if (isRebaseBackupEnabled()) notes.push(t('rewordBackupNote'));
  if (await isPushedCommit(cwd, hash)) notes.push(t('rewordPushedWarn'));
  if (await hasPreRebaseHook(cwd)) notes.push(t('rewordPreRebaseHook'));

  const proceed = t('yes');
  const answer = await vscode.window.showWarningMessage(
    t('confirmReword', hash.substring(0, 8)),
    { modal: true, detail: notes.join('\n\n') },
    proceed
  );
  return answer === proceed;
}

async function execAmendMessage(item, commitInputProvider) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const hash = item.commitHash;

  // HEAD 커밋이면 --amend 로 충분하고, 과거 커밋이면 이후 커밋들까지 재작성해야 한다.
  let headSha;
  try {
    const { stdout } = await execGitSilent(['rev-parse', 'HEAD'], cwd);
    headSha = stdout.trim();
  } catch { return; }
  const isHead = headSha === hash;

  // 사이드바가 최신 커밋이라고 표시한 항목인데 실제 HEAD 가 아니면 목록이 낡은 것이다.
  // (다른 도구로 커밋한 뒤 새로고침하지 않은 경우) — 재작성 대신 새로고침을 안내한다.
  if (item.contextValue === 'historyCommitLatest' && !isHead) {
    vscode.window.showWarningMessage(t('amendOutdated'));
    return;
  }

  if (!isHead) {
    const blocked = await checkRewordable(cwd, hash);
    if (blocked) {
      vscode.window.showWarningMessage(blocked);
      return;
    }
    // 히스토리 재작성은 되돌리기 어려우므로 rebase/reset 과 동일하게 모달로 확인받는다.
    if (!await confirmReword(cwd, hash)) return;
  }

  // 커밋 안 된 변경이 amend 커밋에 섞이지 않도록, 메시지 입력 전에 먼저 확인받는다.
  // (특히 HEAD --amend 는 인덱스 내용을 그대로 커밋에 포함하므로 반드시 필요하다)
  const { proceed } = await confirmStashDirty(cwd);
  if (!proceed) return;

  // 현재 커밋 메시지 조회
  const { stdout: currentMsg } = await execGitSilent(
    ['log', '-1', '--format=%B', hash], cwd
  );

  // 사이드바 메시지 입력창에 현재 메시지를 세팅하고 커밋 버튼 대기
  const amendLabel = t('amendLabel');
  vscode.window.showInformationMessage(t('amendPrompt', amendLabel));
  const userMsg = await commitInputProvider.waitForCommit(currentMsg.trim(), amendLabel);
  if (!userMsg || !userMsg.trim()) return;

  // 커밋 시간 옵션
  const timeChoice = await pickCommitTime(t('amendPlaceholder'));
  if (!timeChoice) return;
  const useNow = timeChoice.value === 'now';

  // 확인받은 변경을 실제 작업 직전에 임시 stash
  const stashed = await stashDirtyIfNeeded(cwd);

  let backupName = null;
  try {
    if (isHead) {
      await amendHeadMessage(cwd, userMsg, useNow);
    } else {
      // 히스토리를 재작성하므로 되돌릴 수 있도록 백업 브랜치를 먼저 만든다.
      backupName = await createRebaseBackupIfEnabled(cwd, await getCurrentBranch(cwd));
      await rewordHistoryCommit(cwd, hash, userMsg, useNow);
    }

    commitInputProvider.addHistory(userMsg);
    vscode.window.showInformationMessage(t('amendDone'));
  } catch (err) {
    // pre-rebase 훅 거부처럼 아무것도 바뀌지 않은 채 실패했다면 방금 만든 백업은 복구할 것이 없다.
    await discardBackupIfUnused(cwd, backupName, headSha);
    vscode.window.showErrorMessage(t('amendFailed', formatGitError(err)));
  } finally {
    await restoreStashIfNeeded(cwd, stashed);
  }
}

// 재작성이 실패했을 때, 저장소가 원래 상태 그대로면 방금 만든 백업 브랜치를 지운다.
// 히스토리가 바뀌었거나 rebase 가 진행 중으로 남았다면 백업이 유일한 복구 수단이므로 남긴다.
async function discardBackupIfUnused(cwd, backupName, originalHead) {
  if (!backupName) return;
  if (await hasInProgressOperation(cwd)) return;

  try {
    const { stdout } = await execGitSilent(['rev-parse', 'HEAD'], cwd);
    if (stdout.trim() !== originalHead) return;   // 히스토리가 바뀜 → 백업을 남긴다
  } catch {
    return;   // 확인 불가 → 안전하게 백업을 남긴다
  }
  await deleteBackupBranches(cwd, [backupName]);
}

module.exports = {
  execCommit, execSquashCommits, execAmendMessage,
};
