'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/git-parse.js — 브랜치 파서 테스트
// parseLocalBranches / parseTrackedRemoteBranches / buildRemoteBranchList
// vscode 스텁 불필요 — 순수 함수.
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLocalBranches,
  parseTrackedRemoteBranches,
  buildRemoteBranchList,
} = require('../lib/git-parse');

describe('parseLocalBranches', () => {
  test('빈 출력은 빈 배열', () => {
    assert.deepEqual(parseLocalBranches(''), []);
    assert.deepEqual(parseLocalBranches(undefined), []);
  });
  test('이름 + "subject (relTime)" 설명 조합', () => {
    const out = 'main\t초기 커밋\t2 days ago\nfeature\t기능 추가\t1 hour ago';
    assert.deepEqual(parseLocalBranches(out), [
      { name: 'main', description: '초기 커밋 (2 days ago)' },
      { name: 'feature', description: '기능 추가 (1 hour ago)' },
    ]);
  });
});

describe('parseTrackedRemoteBranches', () => {
  test('symref(origin/HEAD 등)은 제외', () => {
    const out = [
      'origin/main\t커밋\t1 day ago\t',
      'origin/HEAD\t\t\torigin/main', // symref 필드 존재 → 제외
    ].join('\n');
    const map = parseTrackedRemoteBranches(out);
    assert.equal(map.size, 1);
    assert.ok(map.has('origin/main'));
    assert.deepEqual(map.get('origin/main'), {
      name: 'origin/main', description: '커밋 (1 day ago)',
    });
  });
  test('빈 출력은 빈 Map', () => {
    assert.equal(parseTrackedRemoteBranches('').size, 0);
  });
});

describe('buildRemoteBranchList', () => {
  test('추적 브랜치 먼저, 미페치 브랜치는 이름순 정렬해 뒤에', () => {
    const tracked = new Map([
      ['origin/main', { name: 'origin/main', description: 'm' }],
    ]);
    const remoteLists = [['origin/zeta', 'origin/alpha', 'origin/main']];
    const list = buildRemoteBranchList(tracked, remoteLists, '(미페치)');
    assert.deepEqual(list, [
      { name: 'origin/main', description: 'm' },
      { name: 'origin/alpha', description: '(미페치)', unfetched: true },
      { name: 'origin/zeta', description: '(미페치)', unfetched: true },
    ]);
  });
  test('이미 추적 중인 이름은 미페치로 중복 추가하지 않음', () => {
    const tracked = new Map([['origin/main', { name: 'origin/main', description: 'm' }]]);
    const list = buildRemoteBranchList(tracked, [['origin/main']], '(미페치)');
    assert.equal(list.length, 1);
  });
});
