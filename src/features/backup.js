'use strict';

// rebase 백업 — rebase 직전 복구용 backup/* 브랜치 생성 + 오래된 백업 정리.

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
      await execGit(['branch', '-D', name], cwd);
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

module.exports = {
  isRebaseBackupEnabled,
  getBackupMaxKeep,
  getBackupMaxAgeDays,
  rebaseBackupNote,
  createRebaseBackupIfEnabled,
  findBackupAtHead,
  listBackupBranches,
  execCleanupBackups,
};
