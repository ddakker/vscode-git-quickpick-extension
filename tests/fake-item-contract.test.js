'use strict';

// ─────────────────────────────────────────────────────────────────────
// fakeItem 속성 계약 (M0 critical gap) — 웹뷰가 만든 fakeItem 이 명령 핸들러가
// 읽는 속성을 빠짐없이 제공하는지 검증한다. 누락 시 "무에러·무테스트 조용한 오동작".
// (vscode 스텁 필요)
// ─────────────────────────────────────────────────────────────────────

const stub = require('./vscode-stub');

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { HistoryViewProvider, buildMenu } = require('../src/webview/provider');

// executeCommand 를 가로채 (command, item) 을 기록
function capture() {
  const calls = [];
  stub.commands.executeCommand = (command, item) => { calls.push({ command, item }); return Promise.resolve(); };
  return calls;
}

describe('fakeItem 빌더 (provider._runCommand)', () => {
  test('커밋 fakeItem 은 commitHash + contextValue 제공', async () => {
    const calls = capture();
    const p = new HistoryViewProvider();
    await p._runCommand('gitReflow.copyHash', { kind: 'commit', hash: 'abc123', ctx: 'historyCommit' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'gitReflow.copyHash');
    assert.equal(calls[0].item.commitHash, 'abc123');
    assert.equal(calls[0].item.contextValue, 'historyCommit');
  });

  test('브랜치 fakeItem 은 branchName + contextValue + unfetched 제공', async () => {
    const calls = capture();
    const p = new HistoryViewProvider();
    await p._runCommand('gitReflow.execSwitch', { kind: 'branch', branch: 'origin/feat', ctx: 'remoteBranch', unfetched: true });
    assert.equal(calls[0].item.branchName, 'origin/feat');
    assert.equal(calls[0].item.contextValue, 'remoteBranch');
    assert.equal(calls[0].item.unfetched, true);
  });

  test('원격 브랜치 삭제는 execDeleteRemoteBranch 로 분기', async () => {
    const calls = capture();
    const p = new HistoryViewProvider();
    await p._runCommand('gitReflow.execDeleteBranch', { kind: 'branch', branch: 'origin/x', ctx: 'remoteBranch', unfetched: false });
    assert.equal(calls[0].command, 'gitReflow.execDeleteRemoteBranch');
    assert.equal(calls[0].item.branchName, 'origin/x');
  });

  test('로컬 브랜치 삭제는 execDeleteBranch 유지', async () => {
    const calls = capture();
    const p = new HistoryViewProvider();
    await p._runCommand('gitReflow.execDeleteBranch', { kind: 'branch', branch: 'feat', ctx: 'localBranch', unfetched: false });
    assert.equal(calls[0].command, 'gitReflow.execDeleteBranch');
  });
});

describe('메뉴 계약 (master 트리 메뉴와 동일 구성)', () => {
  const menu = buildMenu();
  const cmds = (ctx) => menu[ctx].map(m => m.command);

  test('historyCommit: 복사 / squash / soft·hard reset', () => {
    assert.deepEqual(cmds('historyCommit'), [
      'gitReflow.copyHash', 'gitReflow.copyMessage', 'gitReflow.execInteractiveRebase',
      'gitReflow.execSoftReset', 'gitReflow.execHardReset',
    ]);
  });
  test('historyCommitLatest: amend 가 squash 앞에 추가', () => {
    assert.deepEqual(cmds('historyCommitLatest'), [
      'gitReflow.copyHash', 'gitReflow.copyMessage', 'gitReflow.execAmendMessage',
      'gitReflow.execInteractiveRebase', 'gitReflow.execSoftReset', 'gitReflow.execHardReset',
    ]);
  });
  test('branchHistoryCommit: 복사 / 체리픽', () => {
    assert.deepEqual(cmds('branchHistoryCommit'),
      ['gitReflow.copyHash', 'gitReflow.copyMessage', 'gitReflow.execCherryPick']);
  });
  test('localBranch: 전환/pull/force-pull/rebase/merge/삭제', () => {
    assert.deepEqual(cmds('localBranch'), [
      'gitReflow.execSwitch', 'gitReflow.execBranchPull', 'gitReflow.execForceBranchPull',
      'gitReflow.execRebase', 'gitReflow.execMerge', 'gitReflow.execDeleteBranch',
    ]);
  });
  test('localBranchCurrent: pull/force-pull 만', () => {
    assert.deepEqual(cmds('localBranchCurrent'),
      ['gitReflow.execBranchPull', 'gitReflow.execForceBranchPull']);
  });
  test('remoteBranch: 전환/rebase/merge/원격삭제', () => {
    assert.deepEqual(cmds('remoteBranch'), [
      'gitReflow.execSwitch', 'gitReflow.execRebase', 'gitReflow.execMerge',
      'gitReflow.execDeleteRemoteBranch',
    ]);
  });
  test('localBranchSection: 브랜치 생성', () => {
    assert.deepEqual(cmds('localBranchSection'), ['gitReflow.createBranch']);
  });
  test('commitFile: 변경 비교 / 로컬과 비교 / 열기(커밋 소스)', () => {
    assert.deepEqual(cmds('commitFile'),
      ['gitReflow.openCommitFileDiff', 'gitReflow.openCommitFileVsLocal', 'gitReflow.openCommitFileContent']);
  });
  test('모든 메뉴 항목은 label 과 command 를 가짐', () => {
    for (const items of Object.values(menu)) {
      for (const it of items) assert.ok(it.command && it.label, `누락: ${JSON.stringify(it)}`);
    }
  });
});

describe('입력창 표시 (showInputWhenChecked)', () => {
  // 옵션값을 주입한 채 fn 실행
  function withOption(on, fn) {
    const orig = stub.workspace.getConfiguration;
    stub.workspace.getConfiguration = () => ({
      get: (key, def) => (key === 'showInputWhenChecked' ? on : (def === undefined ? null : def)),
      update: () => Promise.resolve(), has: () => false, inspect: () => undefined,
    });
    try { return fn(); } finally { stub.workspace.getConfiguration = orig; }
  }
  function makeProvider() {
    const posted = [];
    const p = new HistoryViewProvider({ get: () => [], update: () => {} });
    p._view = { webview: { postMessage: (m) => posted.push(m) }, description: '' };
    return { p, posted };
  }
  const lastVisible = (posted) => posted.filter(m => m.type === 'inputVisible').pop();

  test('옵션 OFF: 항상 표시(visible=true)', () => {
    withOption(false, () => {
      const { p, posted } = makeProvider();
      p.updateInputVisibility();
      assert.equal(lastVisible(posted).visible, true);
    });
  });

  test('옵션 ON + 체크 없음: 숨김(visible=false)', () => {
    withOption(true, () => {
      const { p, posted } = makeProvider();
      p.updateInputVisibility();
      assert.equal(lastVisible(posted).visible, false);
    });
  });

  test('옵션 ON + 체크됨: 표시', () => {
    withOption(true, () => {
      const { p, posted } = makeProvider();
      p._checkedFiles.set('a.txt', true);
      p.updateInputVisibility();
      assert.equal(lastVisible(posted).visible, true);
    });
  });

  test('옵션 ON + 트리 체크 주입: 표시', () => {
    withOption(true, () => {
      const { p, posted } = makeProvider();
      p.setExternalCheckedState(true);
      assert.equal(lastVisible(posted).visible, true);
    });
  });

  test('옵션 ON + 대기 흐름(pendingResolve): 체크 없어도 표시', () => {
    withOption(true, () => {
      const { p, posted } = makeProvider();
      p._pendingResolve = () => {};
      p.updateInputVisibility();
      assert.equal(lastVisible(posted).visible, true);
    });
  });
});
