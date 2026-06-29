'use strict';

// git 읽기 조회 — 브랜치/커밋/스태시/상태 조회. 실행 src/git/exec.js, 파싱 lib/*.js.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { execGit, execGitSilent } = require('./exec');
const { t } = require('../i18n');
const runtime = require('../runtime');
const {
  isAuthError,
  isUnmergedStatus,
  parseStashList,
  parseNameStatus,
} = require('../../lib/git-helpers');
const {
  parseCommitLog,
  parseLocalBranches,
  parseTrackedRemoteBranches,
  buildRemoteBranchList,
} = require('../../lib/git-parse');

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
  return parseLocalBranches(stdout);
}

// 인증 실패 감지 + 사용자 알림 (60초 쓰로틀링)
let _lastAuthWarnTime = 0;
function _warnAuthError(remote) {
  const now = Date.now();
  if (now - _lastAuthWarnTime < 60000) return;
  _lastAuthWarnTime = now;
  vscode.window.showWarningMessage(
    t('authFailed', remote),
    t('openOutput')
  ).then(choice => {
    if (choice === t('openOutput')) {
      const ch = runtime.getOutputChannel();
      if (ch) ch.show(true);
    }
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
async function lsRemoteHeads(cwd, remote) {
  try {
    const { stdout } = await execGit(
      ['ls-remote', '--heads', remote], cwd, { timeout: 15000 }
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
    const msg = err.message || String(err);
    const outputChannel = runtime.getOutputChannel();
    if (outputChannel) {
      outputChannel.appendLine(`[WARN] ls-remote ${remote} failed: ${msg}`);
    }
    // ls-remote 실패는 미페치 브랜치 목록 조회 실패로 비필수 — 사용자 알림 생략
    // (fetchRemoteBranch 실패 시 _warnAuthError 가 호출됨)
    return [];
  }
}

async function getRemoteBranches(cwd) {
  // 1) 로컬 추적 중인 원격 ref — 커밋 메시지/날짜 포함
  const { stdout } = await execGit([
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(subject)%09%(committerdate:relative)%09%(symref)',
    'refs/remotes/',
  ], cwd);
  const tracked = parseTrackedRemoteBranches(stdout);

  // 2) ls-remote 로 원격 브랜치 이름만 덧붙임 (미페치 표시)
  const remotes = await getRemoteNames(cwd);
  const remoteLists = await Promise.all(remotes.map(r => lsRemoteHeads(cwd, r)));
  return buildRemoteBranchList(tracked, remoteLists, t('notFetched'));
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

async function fetchRemoteBranch(cwd, branchName) {
  const slash = branchName.indexOf('/');
  if (slash < 0) return;
  const remote = branchName.substring(0, slash);
  const name = branchName.substring(slash + 1);
  try {
    await execGit(['fetch', remote, name], cwd, { timeout: 60000 });
  } catch (err) {
    if (isAuthError(err)) _warnAuthError(remote);
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

async function getCommitLog(cwd, options = {}) {
  const { branch, count = 30 } = options;
  const args = ['log', '--format=%H%x09%s%x09%an%x09%aI', `-n`, String(count)];
  if (branch) args.push(branch);
  try {
    const { stdout } = await execGitSilent(args, cwd);
    return parseCommitLog(stdout);
  } catch {
    return [];
  }
}

// 한 커밋에서 변경된 파일 목록 — [{ statusCode, filePath }]
// --no-renames: 이름변경을 D+A 로 분리해 상태 글자 매핑을 단순화
async function getCommitFiles(cwd, hash) {
  try {
    // --root: 최초 커밋(parent 없음)도 변경 파일 목록을 반환하게 함
    const { stdout } = await execGit(
      ['diff-tree', '--root', '--no-commit-id', '-r', '--no-renames', '--name-status', hash], cwd
    );
    const files = parseNameStatus(stdout);
    const outputChannel = runtime.getOutputChannel();
    if (outputChannel) outputChannel.appendLine(`[commitFiles] hash=${hash.substring(0,8)} files=${files.length}`);
    return files;
  } catch (err) {
    const outputChannel = runtime.getOutputChannel();
    if (outputChannel) outputChannel.appendLine(`[commitFiles] ERROR hash=${hash.substring(0,8)} ${err && (err.stderr || err.message || String(err))}`);
    return [];
  }
}

module.exports = {
  isGitRepo, getCurrentBranch, getLocalBranches, getRemoteNames, lsRemoteHeads,
  getRemoteBranches, fetchAll, fetchRemoteBranch, getStashList, getStashFiles, ensureRemoteBranchFetched,
  localBranchExists, isDetachedHead, hasInProgressOperation, getChangedFiles,
  fileStatusLetter, fileOpenCommand, getCommitLog, getCommitFiles,
};
