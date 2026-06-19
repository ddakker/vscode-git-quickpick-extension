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

describe('메뉴 계약', () => {
  const menu = buildMenu();
  test('커밋 메뉴 명령은 commitHash 만 있으면 동작하는 것들', () => {
    const cmds = menu.commit.map(m => m.command);
    for (const c of ['gitReflow.copyHash', 'gitReflow.copyMessage', 'gitReflow.viewDiff',
      'gitReflow.execCherryPick', 'gitReflow.resetToHere', 'gitReflow.execAmendMessage',
      'gitReflow.execInteractiveRebase']) {
      assert.ok(cmds.includes(c), `commit 메뉴에 ${c} 필요`);
    }
  });
  test('브랜치 메뉴 명령은 branchName 기반', () => {
    const cmds = menu.branch.map(m => m.command);
    for (const c of ['gitReflow.execSwitch', 'gitReflow.execBranchPull', 'gitReflow.execForceBranchPull',
      'gitReflow.execRebase', 'gitReflow.execMerge', 'gitReflow.execDeleteBranch']) {
      assert.ok(cmds.includes(c), `branch 메뉴에 ${c} 필요`);
    }
  });
  test('모든 메뉴 항목은 label 과 command 를 가짐', () => {
    for (const it of [...menu.commit, ...menu.branch]) {
      assert.ok(it.command && it.label, `메뉴 항목 누락: ${JSON.stringify(it)}`);
    }
  });
});
