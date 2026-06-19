'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/commit-format.js 순수 함수 테스트
// 커밋 라벨/설명/툴팁 포맷을 고정 (리팩토링 전후 동작 보존 증명용).
// vscode 스텁 불필요 — 순수 함수.
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  fitWidth,
  resolveCommitFieldOrder,
  formatCommitFields,
  buildCommitTooltip,
  COMMIT_FIELD_WIDTH,
  DEFAULT_FIELD_ORDER,
} = require('../lib/commit-format');

const SAMPLE = {
  hash: '0123456789abcdef0123456789abcdef01234567',
  message: 'fix: 버그 수정',
  author: 'ddakker',
  date: '2026-06-19 PM 07:30',
};

describe('fitWidth', () => {
  test('짧은 문자열은 공백으로 우측 패딩', () => {
    assert.equal(fitWidth('ab', 5), 'ab   ');
  });
  test('정확히 맞으면 그대로', () => {
    assert.equal(fitWidth('abcde', 5), 'abcde');
  });
  test('길면 width-1 까지 자르고 … 추가', () => {
    assert.equal(fitWidth('abcdef', 5), 'abcd…');
  });
  test('width 가 0/없으면 원본 그대로', () => {
    assert.equal(fitWidth('abcdef', 0), 'abcdef');
    assert.equal(fitWidth('abcdef'), 'abcdef');
  });
  test('숫자도 문자열로 변환', () => {
    assert.equal(fitWidth(42, 4), '42  ');
  });
});

describe('resolveCommitFieldOrder', () => {
  test('null/undefined 면 기본 순서', () => {
    assert.deepEqual(resolveCommitFieldOrder(null), DEFAULT_FIELD_ORDER);
    assert.deepEqual(resolveCommitFieldOrder(undefined), DEFAULT_FIELD_ORDER);
  });
  test('유효 키만 남기고 공백 제거', () => {
    assert.deepEqual(resolveCommitFieldOrder(' hash , author '), ['hash', 'author']);
  });
  test('잘못된 키는 걸러냄', () => {
    assert.deepEqual(resolveCommitFieldOrder('hash,bogus,date'), ['hash', 'date']);
  });
  test('유효 키가 하나도 없으면 기본 순서로 폴백', () => {
    assert.deepEqual(resolveCommitFieldOrder('foo,bar'), DEFAULT_FIELD_ORDER);
    assert.deepEqual(resolveCommitFieldOrder(''), DEFAULT_FIELD_ORDER);
  });
});

describe('formatCommitFields', () => {
  test('기본 순서: label=메시지, description=날짜/작성자/해시(고정폭)', () => {
    const { label, description } = formatCommitFields(SAMPLE, DEFAULT_FIELD_ORDER, COMMIT_FIELD_WIDTH);
    assert.equal(label, 'fix: 버그 수정');
    // date(19) + 2칸 + author(10) + 2칸 + hash(8)
    assert.equal(description, '2026-06-19 PM 07:30' + '  ' + 'ddakker   ' + '  ' + '01234567');
  });
  test('첫 필드만 있으면 description 은 빈 문자열', () => {
    const { label, description } = formatCommitFields(SAMPLE, ['message'], COMMIT_FIELD_WIDTH);
    assert.equal(label, 'fix: 버그 수정');
    assert.equal(description, '');
  });
  test('해시는 8자로 축약', () => {
    const { label } = formatCommitFields(SAMPLE, ['hash'], COMMIT_FIELD_WIDTH);
    assert.equal(label, '01234567');
  });
});

describe('buildCommitTooltip', () => {
  test('날짜/작성자/해시/메시지 순, 주입된 라벨 사용', () => {
    const tip = buildCommitTooltip(SAMPLE, {
      date: 'Date', author: 'Author', hash: 'Hash', message: 'Message',
    });
    assert.equal(tip,
      'Date: 2026-06-19 PM 07:30\n'
      + 'Author: ddakker\n'
      + 'Hash: 0123456789abcdef0123456789abcdef01234567\n'
      + 'Message: fix: 버그 수정');
  });
});
