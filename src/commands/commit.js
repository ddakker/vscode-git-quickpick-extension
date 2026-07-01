'use strict';

// 커밋 명령 — 사이드바 커밋 / squash / amend (커밋 입력 뷰 인스턴스를 주입받음).

const vscode = require('vscode');
const { t, isKo } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');

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
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
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

module.exports = {
  execCommit, execSquashCommits, execAmendMessage,
};
