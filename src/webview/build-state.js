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
const DEFAULT_INPUT_POSITION = 'bottom';
const DEFAULT_HISTORY_COUNT = 10;

// vscode 설정에서 커밋 표시 설정을 읽는다 (null/누락 시 기본값 폴백).
function readCommitConfig() {
  const cfg = vscode.workspace.getConfiguration('gitReflow');
  const fieldOrder = resolveCommitFieldOrder(cfg.get('commitFieldOrder', undefined));
  const styles = cfg.get('commitFieldStyles', null);
  const widths = cfg.get('commitFieldWidths', null);
  const pos = cfg.get('messageInputPosition', null);
  const hc = cfg.get('historyCount', DEFAULT_HISTORY_COUNT);
  return {
    fieldOrder,
    fieldStyles: styles && typeof styles === 'object' ? { ...DEFAULT_FIELD_STYLES, ...styles } : DEFAULT_FIELD_STYLES,
    fieldWidths: widths && typeof widths === 'object' ? { ...DEFAULT_FIELD_WIDTHS, ...widths } : DEFAULT_FIELD_WIDTHS,
    messageInputPosition: ['top', 'bottom'].includes(pos) ? pos : DEFAULT_INPUT_POSITION,
    workspaceInWebview: cfg.get('workspaceInWebview', false) === true,
    historyCount: Number.isInteger(hc) && hc > 0 ? hc : DEFAULT_HISTORY_COUNT,
  };
}

// 히스토리/브랜치 데이터 스냅샷을 만든다.
//   cwd: 작업 디렉토리
//   expanded: { history, localBranch, remoteBranch, [branchName]: true } 펼침 상태
//   deps: git 조회 함수 (테스트 주입용). 기본은 실제 queries.
//   cache: 영속 캐시 객체(provider 보유). 한 번 조회한 데이터를 재사용해 토글이 빠르다.
//          명령 실행/새로고침 시 provider 가 cache 를 비워 다시 조회하게 한다.
async function buildState(cwd, expanded = {}, deps = queries, cache = {}) {
  const {
    getCurrentBranch, hasInProgressOperation, getLocalBranches,
    getRemoteBranches, getCommitLog, ensureRemoteBranchFetched, getCommitFiles,
    getChangedFiles, getStashList, getStashFiles,
  } = deps;

  cache.branchHistory = cache.branchHistory || {};
  cache.commitFiles = cache.commitFiles || {};
  cache.stashFiles = cache.stashFiles || {};

  const config = readCommitConfig();
  const state = {
    inProgress: null,
    currentBranch: '',
    history: null,
    localBranches: null,
    remoteBranches: null,
    branchHistory: {},
    commitFiles: {},        // { [hash]: [{statusCode, filePath}] } — 펼친 커밋만
    workspaceInWebview: config.workspaceInWebview,
    changes: null,          // [{filePath,statusCode,isStaged,isConflict}] — 옵션 ON 일 때만
    stashes: null,          // [{ref,index,message,relTime}] — 스태시 섹션 펼침 시
    stashFiles: {},         // { [ref]: [{statusCode,filePath}] } — 펼친 스태시 항목만
    expanded: { ...expanded },
    config,
  };

  // 진행상태/현재브랜치도 캐시 — 토글 시 git 조회 0회 (네이티브 트리급 반응).
  // 명령 실행/새로고침 때 provider 가 cache 를 비워 갱신한다.
  if (cache.inProgress === undefined) cache.inProgress = await hasInProgressOperation(cwd);
  if (cache.currentBranch === undefined) cache.currentBranch = await getCurrentBranch(cwd);
  state.inProgress = cache.inProgress;
  state.currentBranch = cache.currentBranch;

  // 히스토리 — 펼쳤을 때만 조회 (lazy + 캐시). 개수는 historyCount 설정.
  if (expanded.history) {
    if (!cache.history) cache.history = await getCommitLog(cwd, { count: config.historyCount });
    state.history = cache.history;
  }

  // 로컬 브랜치 — 펼쳤을 때 목록 조회 (캐시)
  if (expanded.localBranch) {
    if (!cache.localBranches) cache.localBranches = await getLocalBranches(cwd);
    state.localBranches = cache.localBranches.map(b => ({
      name: b.name,
      description: b.description,
      isCurrent: b.name === state.currentBranch,
    }));
  }

  // 원격 브랜치 — ls-remote(네트워크) 포함이므로 펼쳤을 때만 (lazy + 캐시)
  if (expanded.remoteBranch) {
    if (!cache.remoteBranches) cache.remoteBranches = await getRemoteBranches(cwd);
    state.remoteBranches = cache.remoteBranches.map(b => ({
      name: b.name,
      description: b.description,
      unfetched: !!b.unfetched,
    }));
  }

  // 펼쳐진 개별 브랜치의 커밋 히스토리 (예약 키 __commits 제외, 캐시)
  const RESERVED = ['history', 'localBranch', 'remoteBranch', '__commits'];
  const branchNames = Object.keys(expanded).filter(k => !RESERVED.includes(k) && expanded[k]);
  for (const name of branchNames) {
    if (cache.branchHistory[name]) { state.branchHistory[name] = cache.branchHistory[name]; continue; }
    try {
      // 미페치 원격 브랜치면 먼저 페치 (실패 시 빈 목록)
      const remote = (state.remoteBranches || []).find(b => b.name === name);
      if (remote && remote.unfetched && ensureRemoteBranchFetched) {
        await ensureRemoteBranchFetched(cwd, name);
      }
      cache.branchHistory[name] = await getCommitLog(cwd, { branch: name, count: config.historyCount });
    } catch {
      cache.branchHistory[name] = [];
    }
    state.branchHistory[name] = cache.branchHistory[name];
  }

  // 펼쳐진 커밋의 변경 파일 목록 (커밋 행 펼침, 캐시)
  const expandedCommits = Array.isArray(expanded.__commits) ? expanded.__commits : [];
  for (const hash of expandedCommits) {
    if (!getCommitFiles) break;
    if (cache.commitFiles[hash]) { state.commitFiles[hash] = cache.commitFiles[hash]; continue; }
    try {
      cache.commitFiles[hash] = await getCommitFiles(cwd, hash);
    } catch {
      cache.commitFiles[hash] = [];
    }
    state.commitFiles[hash] = cache.commitFiles[hash];
  }

  // ─── 변경 사항 + 스태시 (옵션 ON 일 때만) ─────────────────────────
  // 변경 파일은 자주 바뀌므로 캐시를 두되, reload() 가 cache 를 비워 갱신한다.
  if (config.workspaceInWebview) {
    if (getChangedFiles) {
      if (!cache.changes) cache.changes = await getChangedFiles(cwd);
      state.changes = cache.changes;
    } else {
      state.changes = [];
    }

    // 스태시 목록 — 펼쳤을 때만 조회 (lazy + 캐시)
    if (expanded.stash && getStashList) {
      if (!cache.stashes) cache.stashes = await getStashList(cwd);
      state.stashes = cache.stashes;
    }

    // 펼친 스태시 항목의 파일 목록 (캐시)
    const expandedStashes = Array.isArray(expanded.__stashFiles) ? expanded.__stashFiles : [];
    for (const ref of expandedStashes) {
      if (!getStashFiles) break;
      if (cache.stashFiles[ref]) { state.stashFiles[ref] = cache.stashFiles[ref]; continue; }
      try {
        cache.stashFiles[ref] = await getStashFiles(cwd, ref);
      } catch {
        cache.stashFiles[ref] = [];
      }
      state.stashFiles[ref] = cache.stashFiles[ref];
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
