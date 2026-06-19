'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/webview-html.js — 리스트/셸 렌더 테스트 (순수 함수, 스텁 불필요)
// fieldStyles→셀 class, fieldWidths→max-width, 컬럼 수/고정폭, 해시 축약.
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { renderLists, renderShell, renderCommitRow, esc } = require('../lib/webview-html');

const CONFIG = {
  fieldOrder: ['message', 'date', 'author', 'hash'],
  fieldStyles: { message: 'bright', date: 'dim', author: 'dim', hash: 'dim' },
  fieldWidths: { date: 160, author: 90, hash: 70 },
  messageInputPosition: 'top',
};
const COMMIT = { hash: '0123456789abcdef0123', message: 'fix <b>x</b>', author: 'kim', date: '2026-06-19 PM 07:30' };
const LABELS = {
  loading: 'L', noCommits: '커밋 없음', noBranches: '브랜치 없음', current: '(현재)',
  sectionHistory: 'History', sectionLocalBranch: 'Local', sectionRemoteBranch: 'Remote',
  continue: 'Continue', abort: 'Abort',
  inProgress: { rebase: 'rebasing', merge: 'merging', 'cherry-pick': 'cherry' },
};

describe('esc', () => {
  test('HTML 특수문자 이스케이프', () => {
    assert.equal(esc('<b>"x"&\'y\''), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });
});

describe('renderCommitRow', () => {
  test('첫 필드(message)는 bright, 나머지는 dim class', () => {
    const row = renderCommitRow(COMMIT, 'historyCommit', CONFIG);
    assert.ok(row.includes('cell bright msg'));
    assert.ok(row.includes('cell dim meta'));
  });
  test('메타 컬럼에 max-width 적용', () => {
    const row = renderCommitRow(COMMIT, 'historyCommit', CONFIG);
    assert.ok(row.includes('max-width:160px'));
    assert.ok(row.includes('max-width:90px'));
    assert.ok(row.includes('max-width:70px'));
  });
  test('해시는 8자로 축약, 메시지는 이스케이프', () => {
    const row = renderCommitRow(COMMIT, 'historyCommit', CONFIG);
    assert.ok(row.includes('>01234567<'));
    assert.ok(row.includes('fix &lt;b&gt;x&lt;/b&gt;'));
  });
  test('data 속성에 hash/ctx 포함 (fakeItem 용)', () => {
    const row = renderCommitRow(COMMIT, 'branchHistoryCommit', CONFIG);
    assert.ok(row.includes('data-kind="commit"'));
    assert.ok(row.includes('data-hash="0123456789abcdef0123"'));
    assert.ok(row.includes('data-ctx="branchHistoryCommit"'));
  });
  test('컬럼 수 = fieldOrder 길이', () => {
    const row = renderCommitRow(COMMIT, 'historyCommit', CONFIG);
    assert.equal((row.match(/<td/g) || []).length, CONFIG.fieldOrder.length);
  });
});

describe('renderLists', () => {
  const base = {
    inProgress: null, currentBranch: 'main', history: [COMMIT],
    localBranches: null, remoteBranches: null, branchHistory: {},
    expanded: { history: true }, config: CONFIG,
  };
  test('펼친 히스토리 → 테이블, 접힌 섹션은 본문 없음', () => {
    const html = renderLists(base, LABELS);
    assert.ok(html.includes('table class="commits"'));
    assert.ok(html.includes('aria-expanded="true"')); // history
    assert.ok(html.includes('aria-expanded="false"')); // local/remote 접힘
  });
  test('inProgress 면 배너 + continue/abort', () => {
    const html = renderLists({ ...base, inProgress: 'rebase' }, LABELS);
    assert.ok(html.includes('class="banner"'));
    assert.ok(html.includes('data-op="continue"'));
    assert.ok(html.includes('data-op="abort"'));
  });
  test('히스토리 빈 배열 → "커밋 없음"', () => {
    const html = renderLists({ ...base, history: [] }, LABELS);
    assert.ok(html.includes('커밋 없음'));
  });
});

describe('renderShell', () => {
  const opts = (pos) => ({
    nonce: 'N0NCE', cspSource: 'vscode-resource:',
    labels: { tbRefresh: 'R', inputPlaceholder: 'msg', inputCommit: 'Commit' },
    menu: { commit: [], branch: [] }, inputPosition: pos,
  });
  test('CSP + nonce 스크립트 + 툴바 포함', () => {
    const shell = renderShell(opts('top'));
    assert.ok(shell.includes('Content-Security-Policy'));
    assert.ok(shell.includes("script-src 'nonce-N0NCE'"));
    assert.ok(shell.includes('nonce="N0NCE"'));
    assert.ok(shell.includes('data-cmd="gitReflow.refreshView"'));
    assert.ok(shell.includes('data-cmd="gitReflow.execForcePush"'));
  });
  test('입력 영역(textarea + 커밋 버튼) 포함 (요구 2)', () => {
    const shell = renderShell(opts('top'));
    assert.ok(shell.includes('id="inputarea"'));
    assert.ok(shell.includes('id="msg"'));
    assert.ok(shell.includes('id="commitBtn"'));
  });
  test('messageInputPosition → body class (top/bottom/hidden)', () => {
    assert.ok(renderShell(opts('top')).includes('<body class="pos-top">'));
    assert.ok(renderShell(opts('bottom')).includes('<body class="pos-bottom">'));
    assert.ok(renderShell(opts('hidden')).includes('<body class="pos-hidden">'));
  });
  test('잘못된 position 은 top 으로 폴백', () => {
    assert.ok(renderShell(opts('bogus')).includes('<body class="pos-top">'));
  });
});
