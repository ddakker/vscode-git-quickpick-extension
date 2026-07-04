'use strict';

// ─────────────────────────────────────────────────────────────────────
// src/webview/provider.js — refreshChanges()/reload() 캐시·페이지 초기화 범위 테스트
//
// 회귀 시나리오: 워크스페이스의 아무 파일이나 저장(git 히스토리와 무관)해도
// fsWatcher가 reload()를 호출해 히스토리 캐시와 "더 불러오기" 페이지까지
// 1로 리셋시켜, 사용자가 눌러 둔 "더 불러오기" 상태가 자동으로 사라지던 문제.
// refreshChanges()는 changes 캐시만 지우고 history 캐시/페이지는 보존해야 한다.
// (vscode 스텁 필요 — provider.js가 vscode API를 사용)
// ─────────────────────────────────────────────────────────────────────

const stub = require('./vscode-stub');

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { HistoryViewProvider } = require('../src/webview/provider');

function makeProviderWithLoadedHistory() {
  const provider = new HistoryViewProvider();
  // refresh()가 실제 buildState/git 조회를 타지 않도록 no-op으로 대체.
  // 이 테스트는 refreshChanges()/reload()가 캐시·페이지를 어떻게 초기화하는지만 검증한다.
  provider.refresh = async () => {};
  // 사용자가 "더 불러오기"를 여러 번 눌러 히스토리를 3페이지까지 불러온 상태를 재현.
  provider._historyPage = 3;
  provider._branchPages = { feature: 2 };
  provider._cache = {
    history: [{ hash: 'h1' }, { hash: 'h2' }],
    historyFetchCount: 31,
    branchHistory: { feature: [{ hash: 'b1' }] },
    branchHistoryFetchCount: { feature: 21 },
    changes: [{ filePath: 'a.txt', statusCode: 'M' }],
  };
  return provider;
}

describe('HistoryViewProvider refresh scope', () => {
  test('refreshChanges()는 changes 캐시만 지우고 히스토리 캐시/페이지는 보존한다', async () => {
    const provider = makeProviderWithLoadedHistory();

    await provider.refreshChanges();

    assert.equal(provider._cache.changes, undefined, 'changes 캐시는 무효화되어야 함');
    assert.equal(provider._historyPage, 3, '히스토리 페이지는 리셋되면 안 됨');
    assert.deepEqual(provider._branchPages, { feature: 2 }, '브랜치별 페이지도 리셋되면 안 됨');
    assert.deepEqual(provider._cache.history, [{ hash: 'h1' }, { hash: 'h2' }], '히스토리 캐시는 보존되어야 함');
    assert.equal(provider._cache.historyFetchCount, 31);
    assert.deepEqual(provider._cache.branchHistory, { feature: [{ hash: 'b1' }] });
  });

  test('reload()는 기존대로 캐시 전체와 페이지를 1로 초기화한다', async () => {
    const provider = makeProviderWithLoadedHistory();

    await provider.reload();

    assert.equal(provider._historyPage, 1);
    assert.deepEqual(provider._branchPages, {});
    assert.deepEqual(provider._cache, {});
  });
});
