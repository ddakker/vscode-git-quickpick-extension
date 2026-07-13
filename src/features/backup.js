'use strict';

// rebase 백업 — 히스토리를 재작성하는 작업(rebase / 과거 커밋 메시지 수정) 직전에
// 복구용 backup/* 브랜치를 만들고, 설정 기준으로 오래된 백업을 정리한다.

const vscode = require('vscode');
const { t } = require('../i18n');
const { execGit, execGitSilent } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { buildRebaseBackupName, selectStaleBackups } = require('../../lib/git-helpers');

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
    await execGit(['branch', backupName, 'HEAD'], cwd);
    vscode.window.showInformationMessage(t('backupCreated', backupName));
  } catch (err) {
    const msg = (err.stderr || err.message || String(err)).trim();
    vscode.window.showWarningMessage(t('backupFailed', msg));
    return;
  }

  // 방금 만든 백업 때문에 이 브랜치의 백업이 backupMaxKeep 을 넘었다면 초과분만 정리한다.
  await pruneStaleBackups(cwd, currentBranch);
}

// 수동 정리(execCleanupBackups) 대상 — 모든 브랜치의 백업을 개수/기간 두 기준으로 검사한다.
async function findStaleBackups(cwd) {
  const names = await listBackupBranches(cwd);
  return selectStaleBackups(names, {
    maxKeep: getBackupMaxKeep(),
    maxAgeDays: getBackupMaxAgeDays(),
  });
}

// 백업 브랜치들을 삭제하고 성공/실패 개수를 반환한다.
async function deleteBackupBranches(cwd, names) {
  let ok = 0;
  let fail = 0;
  for (const name of names) {
    try {
      await execGit(['branch', '-D', name], cwd);
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

// 백업 생성 직후의 자동 정리 — 확인 없이 지우므로 범위를 좁게 잡는다.
//   - 방금 백업을 만든 그 브랜치의 백업만 대상 (다른 브랜치의 복구 지점은 건드리지 않는다)
//   - 개수 초과분(backupMaxKeep)만 대상 (기간 기준 삭제는 확인 모달이 있는 수동 정리에 맡긴다)
// 삭제 실패는 무시한다 — 정리 실패가 본 작업을 막아서는 안 된다.
async function pruneStaleBackups(cwd, branch) {
  const names = await listBackupBranches(cwd, branch);
  const stale = selectStaleBackups(names, { maxKeep: getBackupMaxKeep(), maxAgeDays: 0 });
  if (stale.length === 0) return;
  const { ok } = await deleteBackupBranches(cwd, stale);
  if (ok > 0) vscode.window.showInformationMessage(t('backupPruned', ok));
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

// backup/* 브랜치 이름 목록을 반환 (없으면 빈 배열).
// branch 를 주면 그 브랜치의 백업(backup/<branch>/*)만, 없으면 전체를 반환한다.
async function listBackupBranches(cwd, branch) {
  const ref = branch ? `refs/heads/backup/${branch}` : 'refs/heads/backup';
  try {
    const { stdout } = await execGitSilent(
      ['for-each-ref', '--format=%(refname:short)', ref], cwd
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

  const stale = await findStaleBackups(cwd);

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

  const { ok, fail } = await deleteBackupBranches(cwd, stale);

  if (fail === 0) {
    vscode.window.showInformationMessage(t('cleanupBackupsDone', ok));
  } else {
    vscode.window.showWarningMessage(t('cleanupBackupsPartial', ok, fail));
  }
}

module.exports = {
  isRebaseBackupEnabled,
  getBackupMaxKeep,
  getBackupMaxAgeDays,
  rebaseBackupNote,
  createRebaseBackupIfEnabled,
  findBackupAtHead,
  listBackupBranches,
  pruneStaleBackups,
  execCleanupBackups,
};
