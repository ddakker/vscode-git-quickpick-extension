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
const runtime = require('../runtime');
const { resolveCommitFieldOrder } = require('../../lib/commit-format');

const DEFAULT_FIELD_STYLES = { message: 'bright', date: 'dim', author: 'dim', hash: 'dim' };
const DEFAULT_FIELD_WIDTHS = { date: 160, author: 90, hash: 70 };
const DEFAULT_INPUT_POSITION = 'bottom';
const DEFAULT_HISTORY_COUNT = 10; // 한 페이지당 커밋 수 (더 불러오기 단위)

// vscode 설정에서 커밋 표시 설정을 읽는다 (null/누락 시 기본값 폴백).
function readCommitConfig() {
  const cfg = vscode.workspace.getConfiguration('gitReflow');
  const fieldOrder = resolveCommitFieldOrder(cfg.get('commitFieldOrder', undefined));
  const authorWidth = cfg.get('authorWidth', null);
  const pos = cfg.get('messageInputPosition', null);
  const fieldWidths = { ...DEFAULT_FIELD_WIDTHS };
  if (typeof authorWidth === 'number' && authorWidth > 0) fieldWidths.author = authorWidth;
  return {
    fieldOrder,
    fieldStyles: DEFAULT_FIELD_STYLES,
    fieldWidths,
    messageInputPosition: ['top', 'bottom'].includes(pos) ? pos : DEFAULT_INPUT_POSITION,
  };
}

// 히스토리/브랜치 데이터 스냅샷을 만든다.
//   cwd: 작업 디렉토리
//   expanded: { history, localBranch, remoteBranch, [branchName]: true } 펼침 상태
//   deps: git 조회 함수 (테스트 주입용). 기본은 실제 queries.
//   cache: 영속 캐시 객체(provider 보유). 한 번 조회한 데이터를 재사용해 토글이 빠르다.
//          명령 실행/새로고침 시 provider 가 cache 를 비워 다시 조회하게 한다.
async function buildState(cwd, expanded = {}, deps = queries, cache = {}, options = {}) {
  const withFetch = !!options.withFetch;
  const {
    getCurrentBranch, hasInProgressOperation, getLocalBranches,
    getRemoteBranches, getCommitLog, fetchRemoteBranch, ensureRemoteBranchFetched, getCommitFiles,
    getChangedFiles, getStashList, getStashFiles,
  } = deps;

  cache.branchHistory = cache.branchHistory || {};
  cache.branchHistoryFetchCount = cache.branchHistoryFetchCount || {};
  cache.commitFiles = cache.commitFiles || {};
  cache.stashFiles = cache.stashFiles || {};

  const config = readCommitConfig();
  const state = {
    inProgress: null,
    currentBranch: '',
    history: null,
    historyHasMore: false,
    localBranches: null,
    remoteBranches: null,
    branchHistory: {},
    branchHistoryHasMore: {},   // { [branchName]: bool }
    commitFiles: {},        // { [hash]: [{statusCode, filePath}] } — 펼친 커밋만
    expandedCommitKeys: [], // ["section|hash", ...] — 섹션별 펼침 상태
    changes: null,          // [{filePath,statusCode,isStaged,isConflict}]
    stashes: null,          // [{ref,index,message,relTime}] — 스태시 섹션 펼침 시
    stashFiles: {},         // { [ref]: [{statusCode,filePath}] } — 펼친 스태시 항목만
    expanded: { ...expanded },
    config,
  };

  // inProgress: 파일 존재 확인만이라 빠름 → 캐시 없이 항상 재확인 (외부 머지/리베이스 즉시 반영).
  // currentBranch: 명령 실행 후 reload() 때 갱신.
  state.inProgress = await hasInProgressOperation(cwd);
  if (cache.currentBranch === undefined) cache.currentBranch = await getCurrentBranch(cwd);
  state.currentBranch = cache.currentBranch;

  // 히스토리 — 펼쳤을 때만 조회 (lazy + 캐시). N+1 개 조회해 "더 있음" 감지.
  if (expanded.history) {
    const histPage = (Number.isInteger(expanded.__historyPage) && expanded.__historyPage > 0)
      ? expanded.__historyPage : 1;
    const fetchCount = DEFAULT_HISTORY_COUNT * histPage + 1;
    if (!cache.history || cache.historyFetchCount !== fetchCount) {
      cache.history = await getCommitLog(cwd, { count: fetchCount });
      cache.historyFetchCount = fetchCount;
    }
    state.historyHasMore = cache.history.length > DEFAULT_HISTORY_COUNT * histPage;
    state.history = cache.history.slice(0, DEFAULT_HISTORY_COUNT * histPage);
  }

  // 로컬 브랜치 — 펼쳤을 때 목록 조회 (캐시)
  if (expanded.localBranch) {
    if (!cache.localBranches) cache.localBranches = await getLocalBranches(cwd);
    state.localBranches = cache.localBranches
      .map(b => ({ name: b.name, description: b.description, isCurrent: b.name === state.currentBranch }))
      .sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0));
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

  // 펼쳐진 개별 브랜치의 커밋 히스토리 (예약 키 제외, 캐시 + 페이지)
  const RESERVED = new Set(['history', 'localBranch', 'remoteBranch', 'changes', 'stash',
    '__commits', '__stashFiles', '__historyPage', '__branchPages']);
  const branchNames = Object.keys(expanded).filter(k => !RESERVED.has(k) && expanded[k]);
  const branchPages = (expanded.__branchPages && typeof expanded.__branchPages === 'object')
    ? expanded.__branchPages : {};
  for (const name of branchNames) {
    const page = (Number.isInteger(branchPages[name]) && branchPages[name] > 0)
      ? branchPages[name] : 1;
    const fetchCount = DEFAULT_HISTORY_COUNT * page + 1;
    const allRemotes = state.remoteBranches || cache.remoteBranches || [];
    const remote = allRemotes.find(b => b.name === name);
    const fetchCounted = cache.branchHistoryFetchCount[name] === fetchCount;

    // 로컬 브랜치: 캐시가 유효하면 재사용 (git log 생략)
    if (!remote && cache.branchHistory[name] && fetchCounted) {
      state.branchHistory[name] = cache.branchHistory[name].slice(0, DEFAULT_HISTORY_COUNT * page);
      state.branchHistoryHasMore[name] = cache.branchHistory[name].length > DEFAULT_HISTORY_COUNT * page;
      continue;
    }

    // 원격 브랜치: 사용자가 직접 새로고침할 때(withFetch)만 네트워크 fetch
    try {
      if (remote && withFetch) {
        if (fetchRemoteBranch) await fetchRemoteBranch(cwd, name);
        else if (ensureRemoteBranchFetched) await ensureRemoteBranchFetched(cwd, name);
      }
      cache.branchHistory[name] = await getCommitLog(cwd, { branch: name, count: fetchCount });
      cache.branchHistoryFetchCount[name] = fetchCount;
    } catch {
      cache.branchHistory[name] = [];
      cache.branchHistoryFetchCount[name] = fetchCount;
    }
    state.branchHistory[name] = cache.branchHistory[name].slice(0, DEFAULT_HISTORY_COUNT * page);
    state.branchHistoryHasMore[name] = cache.branchHistory[name].length > DEFAULT_HISTORY_COUNT * page;
  }

  // 펼쳐진 커밋의 변경 파일 목록 (커밋 행 펼침, 캐시)
  // __commits 는 "section|hash" 복합 키 배열 (구버전 호환: 순수 해시도 허용)
  const expandedCommits = Array.isArray(expanded.__commits) ? expanded.__commits : [];
  state.expandedCommitKeys = expandedCommits;
  const _ch = runtime.getOutputChannel();
  for (const key of expandedCommits) {
    const hash = key.includes('|') ? key.split('|').pop() : key;
    if (cache.commitFiles[hash]) {
      if (_ch) _ch.appendLine(`[buildState] commitFiles cache hit: ${hash.substring(0,8)}`);
      state.commitFiles[hash] = cache.commitFiles[hash];
      continue;
    }
    if (!getCommitFiles) continue;
    if (_ch) _ch.appendLine(`[buildState] commitFiles fetch: ${hash.substring(0,8)} cwd=${cwd}`);
    try {
      cache.commitFiles[hash] = await getCommitFiles(cwd, hash);
    } catch {
      cache.commitFiles[hash] = [];
    }
    state.commitFiles[hash] = cache.commitFiles[hash];
  }

  // ─── 변경 사항 + 스태시 ────────────────────────────────────────────
  // 변경 파일은 자주 바뀌므로 캐시를 두되, reload() 가 cache 를 비워 갱신한다.
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

  return state;
}

module.exports = {
  buildState,
  readCommitConfig,
  DEFAULT_INPUT_POSITION,
};
