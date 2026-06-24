'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/webview-html.js — 리스트/셸 렌더 테스트 (순수 함수, 스텁 불필요)
// fieldStyles→셀 class, fieldWidths→width, 컬럼 수/고정폭, 해시 축약.
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  renderLists, renderShell, renderCommitRow, renderChanges, renderStash, esc,
} = require('../lib/webview-html');

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
  test('메타 컬럼에 width 적용', () => {
    const row = renderCommitRow(COMMIT, 'historyCommit', CONFIG);
    assert.ok(row.includes('width:160px'));
    assert.ok(row.includes('width:90px'));
    assert.ok(row.includes('width:70px'));
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

describe('커밋 파일 펼침 (commitFiles)', () => {
  const base = {
    inProgress: null, currentBranch: 'main', history: [COMMIT],
    localBranches: null, remoteBranches: null, branchHistory: {},
    expanded: { history: true }, config: CONFIG,
  };
  test('commitFiles 없으면 파일행 없음, 있으면 렌더 + chevron ▾', () => {
    const collapsed = renderLists({ ...base, commitFiles: {} }, LABELS);
    assert.ok(!collapsed.includes('class="cfile"'));
    const files = [{ statusCode: 'M', filePath: 'src/a.js' }, { statusCode: 'A', filePath: 'b.txt' }, { statusCode: 'D', filePath: 'c.txt' }];
    const expanded = renderLists({ ...base, commitFiles: { [COMMIT.hash]: files } }, LABELS);
    assert.equal((expanded.match(/class="cfile"/g) || []).length, 3);
    assert.ok(expanded.includes('▾')); // 펼침 표시
    assert.ok(expanded.includes('data-file="src/a.js"'));
  });
  test('상태 글자 매핑 M→U, A→A, D→D', () => {
    const files = [{ statusCode: 'M', filePath: 'm' }, { statusCode: 'A', filePath: 'a' }, { statusCode: 'D', filePath: 'd' }];
    const html = renderLists({ ...base, commitFiles: { [COMMIT.hash]: files } }, LABELS);
    assert.ok(html.includes('cfl-U') && html.includes('cfl-A') && html.includes('cfl-D'));
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

// 변경/스태시 렌더용 라벨
const WS_LABELS = {
  ...LABELS,
  sectionCommit: '변경 사항', sectionStash: '스태시',
  selectAll: '전체 선택/해제', toggleFileView: '보기 전환',
  noChanges: '변경 없음', noStash: '스태시 없음', noDiffFiles: '파일 없음',
};

describe('renderChanges', () => {
  const changes = [
    { filePath: 'src/a.js', statusCode: 'M', isStaged: false, isConflict: false },
    { filePath: 'b.txt', statusCode: '?', isStaged: false, isConflict: false },
    { filePath: 'd.txt', statusCode: 'D', isStaged: false, isConflict: false },
  ];
  const base = (over = {}) => ({
    expanded: { changes: true }, changes,
    checkedFiles: new Set(), fileViewMode: 'list', ...over,
  });

  test('list 모드: 파일별 체크박스 + contextValue + 전체선택', () => {
    const html = renderChanges(base(), WS_LABELS);
    assert.equal((html.match(/data-kind="changedFile"/g) || []).length, 3);
    assert.ok(html.includes('data-kind="selectAll"'));
    assert.ok(html.includes('data-ctx="fileModified"'));
    assert.ok(html.includes('data-ctx="fileUntracked"'));
    assert.ok(html.includes('data-ctx="fileDeleted"'));
    assert.ok(html.includes('type="checkbox"'));
    assert.ok(html.includes('data-path="src/a.js"'));
  });

  test('체크된 파일은 checkbox checked', () => {
    const html = renderChanges(base({ checkedFiles: new Set(['b.txt']) }), WS_LABELS);
    // b.txt 행에 checked 가 있고, 전체선택은 모두 체크 아님
    const row = html.split('data-path="b.txt"')[0].split('class="chfile"').pop();
    assert.ok(html.includes('data-path="b.txt"'));
    assert.ok(/checked/.test(html));
  });

  test('전체 체크 시 selectAll 도 checked', () => {
    const all = new Set(['src/a.js', 'b.txt', 'd.txt']);
    const html = renderChanges(base({ checkedFiles: all }), WS_LABELS);
    const selRow = html.substring(html.indexOf('data-kind="selectAll"'));
    assert.ok(selRow.startsWith('data-kind="selectAll"'));
    // selectAll 입력에 checked 포함
    const selInput = selRow.substring(0, selRow.indexOf('</div>'));
    assert.ok(selInput.includes('checked'));
  });

  test('tree 모드: 디렉터리 폴더행 렌더', () => {
    const html = renderChanges(base({ fileViewMode: 'tree' }), WS_LABELS);
    assert.ok(html.includes('class="chdir"'));
    assert.ok(html.includes('chdir-body'));
    assert.ok(html.includes('>src<')); // 폴더 이름
  });

  test('변경 없음 → noChanges', () => {
    const html = renderChanges(base({ changes: [] }), WS_LABELS);
    assert.ok(html.includes('변경 없음'));
  });

  test('list/tree 보기 전환 토글 버튼 포함', () => {
    const html = renderChanges(base(), WS_LABELS);
    assert.ok(html.includes('data-kind="fileViewToggle"'));
  });
});

describe('renderStash', () => {
  const stashes = [{ ref: 'stash@{0}', index: 0, message: 'wip', relTime: '1h' }];
  test('접힘: 본문 없음', () => {
    const html = renderStash({ expanded: {}, stashes, stashFiles: {} }, WS_LABELS);
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(!html.includes('data-kind="stash"'));
  });
  test('펼침: 스태시 항목 행 + 메뉴 ctx', () => {
    const html = renderStash({ expanded: { stash: true }, stashes, stashFiles: {} }, WS_LABELS);
    assert.ok(html.includes('data-kind="stash"'));
    assert.ok(html.includes('data-ctx="stashEntry"'));
    assert.ok(html.includes('data-ref="stash@{0}"'));
    assert.ok(html.includes('wip'));
  });
  test('항목 펼침: 파일 목록 렌더', () => {
    const sf = { 'stash@{0}': [{ statusCode: 'M', filePath: 'b.txt' }] };
    const html = renderStash({ expanded: { stash: true }, stashes, stashFiles: sf }, WS_LABELS);
    assert.ok(html.includes('data-kind="stashFile"'));
    assert.ok(html.includes('data-path="b.txt"'));
  });
  test('스태시 없음 → noStash', () => {
    const html = renderStash({ expanded: { stash: true }, stashes: [], stashFiles: {} }, WS_LABELS);
    assert.ok(html.includes('스태시 없음'));
  });
});

describe('renderLists + workspace 섹션', () => {
  const base = {
    inProgress: null, currentBranch: 'main', history: [COMMIT],
    localBranches: null, remoteBranches: null, branchHistory: {}, commitFiles: {},
    expanded: { history: true, changes: true }, config: CONFIG,
    workspaceInWebview: true,
    changes: [{ filePath: 'a.txt', statusCode: 'M', isStaged: false, isConflict: false }],
    checkedFiles: new Set(), fileViewMode: 'list', stashes: null, stashFiles: {},
  };
  test('옵션 ON: 변경 섹션이 히스토리보다 앞', () => {
    const html = renderLists(base, WS_LABELS);
    assert.ok(html.includes('data-section="changes"'));
    assert.ok(html.indexOf('data-section="changes"') < html.indexOf('data-section="history"'));
  });
  test('옵션 ON: 스태시 섹션이 맨 뒤(원격 뒤)', () => {
    const html = renderLists(base, WS_LABELS);
    assert.ok(html.indexOf('data-section="stash"') > html.indexOf('data-section="remoteBranch"'));
  });
});

describe('renderShell', () => {
  const opts = (pos) => ({
    nonce: 'N0NCE', cspSource: 'vscode-resource:',
    labels: { tbRefresh: 'R', inputPlaceholder: 'msg', inputCommit: 'Commit' },
    menu: { commit: [], branch: [] }, inputPosition: pos,
  });
  test('CSP + nonce 스크립트 포함 (툴바는 네이티브 타이틀바로 이전)', () => {
    const shell = renderShell(opts('top'));
    assert.ok(shell.includes('Content-Security-Policy'));
    assert.ok(shell.includes("script-src 'nonce-N0NCE'"));
    assert.ok(shell.includes('nonce="N0NCE"'));
    assert.ok(!shell.includes('class="toolbar"')); // 커스텀 HTML 툴바 제거됨
  });
  test('입력 영역(textarea + 커밋 버튼) 포함 (요구 2)', () => {
    const shell = renderShell(opts('top'));
    assert.ok(shell.includes('id="inputarea"'));
    assert.ok(shell.includes('id="msg"'));
    assert.ok(shell.includes('id="commitBtn"'));
  });
  test('messageInputPosition → body class (top/bottom)', () => {
    assert.ok(renderShell(opts('top')).includes('<body class="pos-top">'));
    assert.ok(renderShell(opts('bottom')).includes('<body class="pos-bottom">'));
  });
  test('제거된 hidden/잘못된 position 은 bottom 으로 폴백', () => {
    assert.ok(renderShell(opts('hidden')).includes('<body class="pos-bottom">'));
    assert.ok(renderShell(opts('bogus')).includes('<body class="pos-bottom">'));
  });
});
