'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/git-parse.js — git stdout 파서 테스트 (parseCommitLog)
// parseNameStatus / parseStashList 는 git-helpers.test.js 에서 검증.
// vscode 스텁 불필요 — 순수 함수.
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseCommitLog } = require('../lib/git-parse');
const { formatCommitDate } = require('../lib/git-helpers');

describe('parseCommitLog', () => {
  test('빈 출력은 빈 배열', () => {
    assert.deepEqual(parseCommitLog(''), []);
    assert.deepEqual(parseCommitLog('   \n  '), []);
    assert.deepEqual(parseCommitLog(undefined), []);
  });

  test('탭 구분 한 줄을 객체로 변환 (date 는 formatCommitDate 적용)', () => {
    const iso = '2026-06-19T19:30:00+09:00';
    const out = `abc123\tfix: 버그\tddakker\t${iso}`;
    const [c] = parseCommitLog(out);
    assert.equal(c.hash, 'abc123');
    assert.equal(c.message, 'fix: 버그');
    assert.equal(c.author, 'ddakker');
    assert.equal(c.date, formatCommitDate(iso)); // 래퍼가 날짜 포맷을 적용하는지 확인
  });

  test('여러 줄을 순서대로 파싱', () => {
    const out = [
      'h1\tmsg one\talice\t2026-01-01T00:00:00Z',
      'h2\tmsg two\tbob\t2026-02-02T00:00:00Z',
    ].join('\n');
    const commits = parseCommitLog(out);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].hash, 'h1');
    assert.equal(commits[1].author, 'bob');
  });

  test('끝의 개행/공백을 trim 후 파싱', () => {
    const out = 'h1\tm\ta\t2026-01-01T00:00:00Z\n';
    assert.equal(parseCommitLog(out).length, 1);
  });
});
