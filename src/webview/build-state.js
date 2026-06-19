'use strict';

// ─────────────────────────────────────────────────────────────────────
// buildState — 히스토리/브랜치 webview 의 순수 데이터 스냅샷 빌더.
//
//  - 트리의 _getHistoryItems/_getLocalBranchItems/_getRemoteBranchItems/
//    _getBranchHistoryItems 로직을 "데이터 반환"으로 이식.
//  - lazy: 펼쳐진(expanded) 섹션의 데이터만 채운다(P1). 접힌 섹션은 git 조회 생략.
//  - unfetched 는 매번 재계산되는 source of truth (fakeItem 변이는 버려짐, A2).
//  - git 조회 함수는 deps 로 주입 가능 → 테스트에서 스텁/실저장소 모두 사용.
// ─────────────────────────────────────────────────────────────────────

const vscode = require('vscode');
const queries = require('../git/queries');
const { resolveCommitFieldOrder } = require('../../lib/commit-format');

const DEFAULT_FIELD_STYLES = { message: 'bright', date: 'dim', author: 'dim', hash: 'dim' };
const DEFAULT_FIELD_WIDTHS = { date: 160, author: 90, hash: 70 };
const DEFAULT_INPUT_POSITION = 'top';

// vscode 설정에서 커밋 표시 설정을 읽는다 (null/누락 시 기본값 폴백).
function readCommitConfig() {
  const cfg = vscode.workspace.getConfiguration('gitReflow');
  const fieldOrder = resolveCommitFieldOrder(cfg.get('commitFieldOrder', undefined));
  const styles = cfg.get('commitFieldStyles', null);
  const widths = cfg.get('commitFieldWidths', null);
  const pos = cfg.get('messageInputPosition', null);
  return {
    fieldOrder,
    fieldStyles: styles && typeof styles === 'object' ? { ...DEFAULT_FIELD_STYLES, ...styles } : DEFAULT_FIELD_STYLES,
    fieldWidths: widths && typeof widths === 'object' ? { ...DEFAULT_FIELD_WIDTHS, ...widths } : DEFAULT_FIELD_WIDTHS,
    messageInputPosition: ['top', 'bottom', 'hidden'].includes(pos) ? pos : DEFAULT_INPUT_POSITION,
  };
}

// 히스토리/브랜치 데이터 스냅샷을 만든다.
//   cwd: 작업 디렉토리
//   expanded: { history, localBranch, remoteBranch, [branchName]: true } 펼침 상태
//   deps: git 조회 함수 (테스트 주입용). 기본은 실제 queries.
async function buildState(cwd, expanded = {}, deps = queries) {
  const {
    getCurrentBranch, hasInProgressOperation, getLocalBranches,
    getRemoteBranches, getCommitLog, ensureRemoteBranchFetched,
  } = deps;

  const config = readCommitConfig();
  const state = {
    inProgress: null,
    currentBranch: '',
    history: null,
    localBranches: null,
    remoteBranches: null,
    branchHistory: {},
    expanded: { ...expanded },
    config,
  };

  state.inProgress = await hasInProgressOperation(cwd);
  state.currentBranch = await getCurrentBranch(cwd);

  // 히스토리 — 펼쳤을 때만 조회 (lazy)
  if (expanded.history) {
    state.history = await getCommitLog(cwd);
  }

  // 로컬 브랜치 — 가벼우므로 펼쳤을 때 목록 조회
  if (expanded.localBranch) {
    const branches = await getLocalBranches(cwd);
    state.localBranches = branches.map(b => ({
      name: b.name,
      description: b.description,
      isCurrent: b.name === state.currentBranch,
    }));
  }

  // 원격 브랜치 — ls-remote(네트워크) 포함이므로 펼쳤을 때만 (lazy)
  if (expanded.remoteBranch) {
    const branches = await getRemoteBranches(cwd);
    state.remoteBranches = branches.map(b => ({
      name: b.name,
      description: b.description,
      unfetched: !!b.unfetched, // source of truth (매번 재계산)
    }));
  }

  // 펼쳐진 개별 브랜치의 커밋 히스토리
  const branchNames = Object.keys(expanded).filter(k =>
    !['history', 'localBranch', 'remoteBranch'].includes(k) && expanded[k]);
  for (const name of branchNames) {
    // 미페치 원격 브랜치면 먼저 페치 (실패 시 빈 목록)
    try {
      const remote = (state.remoteBranches || []).find(b => b.name === name);
      if (remote && remote.unfetched && ensureRemoteBranchFetched) {
        await ensureRemoteBranchFetched(cwd, name);
      }
      state.branchHistory[name] = await getCommitLog(cwd, { branch: name });
    } catch {
      state.branchHistory[name] = [];
    }
  }

  return state;
}

module.exports = {
  buildState,
  readCommitConfig,
  DEFAULT_FIELD_STYLES,
  DEFAULT_FIELD_WIDTHS,
  DEFAULT_INPUT_POSITION,
};
