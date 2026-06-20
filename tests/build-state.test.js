'use strict';

// ─────────────────────────────────────────────────────────────────────
// src/webview/build-state.js — buildState 테스트 (git 조회 deps 주입)
// 빈 저장소·inProgress·lazy(접힌 섹션 미조회)·브랜치 히스토리·unfetched 재계산.
// (vscode 스텁 필요 — readCommitConfig 가 설정을 읽음)
// ─────────────────────────────────────────────────────────────────────

require('./vscode-stub');

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildState } = require('../src/webview/build-state');

// 호출을 기록하는 가짜 git 조회 deps
function makeDeps(over = {}) {
  const calls = [];
  const rec = (name, ret) => (...a) => { calls.push(name); return Promise.resolve(ret); };
  return {
    calls,
    deps: {
      getCurrentBranch: rec('getCurrentBranch', 'main'),
      hasInProgressOperation: rec('hasInProgressOperation', null),
      getLocalBranches: rec('getLocalBranches', [{ name: 'main', description: 'd' }, { name: 'feat', description: 'd' }]),
      getRemoteBranches: rec('getRemoteBranches', [{ name: 'origin/main', description: 'd', unfetched: false }, { name: 'origin/new', description: '(미페치)', unfetched: true }]),
      getCommitLog: rec('getCommitLog', [{ hash: 'h1', message: 'm', author: 'a', date: 'd' }]),
      ensureRemoteBranchFetched: rec('ensureRemoteBranchFetched'),
      getCommitFiles: rec('getCommitFiles', [{ statusCode: 'M', filePath: 'a.txt' }]),
      ...over,
    },
  };
}

describe('buildState', () => {
  test('접힌 섹션은 git 조회 생략 (lazy)', async () => {
    const { calls, deps } = makeDeps();
    const state = await buildState('/x', {}, deps);
    // 항상: hasInProgressOperation, getCurrentBranch
    assert.ok(calls.includes('hasInProgressOperation'));
    assert.ok(calls.includes('getCurrentBranch'));
    // 접힘: 히스토리/브랜치 조회 안 함
    assert.ok(!calls.includes('getCommitLog'));
    assert.ok(!calls.includes('getLocalBranches'));
    assert.ok(!calls.includes('getRemoteBranches'));
    assert.equal(state.history, null);
    assert.equal(state.localBranches, null);
  });

  test('history 펼치면 getCommitLog 호출', async () => {
    const { calls, deps } = makeDeps();
    const state = await buildState('/x', { history: true }, deps);
    assert.ok(calls.includes('getCommitLog'));
    assert.equal(state.history.length, 1);
  });

  test('inProgress 감지', async () => {
    const { deps } = makeDeps({ hasInProgressOperation: () => Promise.resolve('merge') });
    const state = await buildState('/x', {}, deps);
    assert.equal(state.inProgress, 'merge');
  });

  test('로컬 브랜치 isCurrent 표시', async () => {
    const { deps } = makeDeps();
    const state = await buildState('/x', { localBranch: true }, deps);
    const main = state.localBranches.find(b => b.name === 'main');
    const feat = state.localBranches.find(b => b.name === 'feat');
    assert.equal(main.isCurrent, true);
    assert.equal(feat.isCurrent, false);
  });

  test('원격 브랜치 unfetched 재계산 (source of truth)', async () => {
    const { deps } = makeDeps();
    const state = await buildState('/x', { remoteBranch: true }, deps);
    assert.equal(state.remoteBranches.find(b => b.name === 'origin/new').unfetched, true);
    assert.equal(state.remoteBranches.find(b => b.name === 'origin/main').unfetched, false);
  });

  test('펼친 개별 브랜치는 branchHistory 채움', async () => {
    const { deps } = makeDeps();
    const state = await buildState('/x', { feat: true }, deps);
    assert.ok(Array.isArray(state.branchHistory.feat));
    assert.equal(state.branchHistory.feat.length, 1);
  });

  test('펼친 커밋(__commits)은 commitFiles 채움', async () => {
    const { calls, deps } = makeDeps();
    const state = await buildState('/x', { history: true, __commits: ['h1'] }, deps);
    assert.ok(calls.includes('getCommitFiles'));
    assert.deepEqual(state.commitFiles.h1, [{ statusCode: 'M', filePath: 'a.txt' }]);
  });

  test('펼친 커밋 없으면 getCommitFiles 미호출', async () => {
    const { calls, deps } = makeDeps();
    await buildState('/x', { history: true }, deps);
    assert.ok(!calls.includes('getCommitFiles'));
  });

  test('빈/에러 저장소에서 throw 없이 동작', async () => {
    const { deps } = makeDeps({
      getCommitLog: () => Promise.resolve([]),
      getLocalBranches: () => Promise.resolve([]),
    });
    const state = await buildState('/x', { history: true, localBranch: true }, deps);
    assert.deepEqual(state.history, []);
    assert.deepEqual(state.localBranches, []);
  });
});
