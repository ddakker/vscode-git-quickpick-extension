'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/relative-date.js — 상대 시간 문구 테스트
// blame 인라인 표시용. 경계값(분/시간/일/개월/년) + 한/영 고정.
// vscode 스텁 불필요 — 순수 함수.
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { formatRelativeText } = require('../lib/relative-date');

describe('formatRelativeText (영어)', () => {
  test('60초 미만 → just now', () => {
    assert.equal(formatRelativeText(0, false), 'just now');
    assert.equal(formatRelativeText(59, false), 'just now');
  });
  test('분 단위', () => {
    assert.equal(formatRelativeText(60, false), '1 min ago');
    assert.equal(formatRelativeText(3599, false), '59 min ago');
  });
  test('시간 단위', () => {
    assert.equal(formatRelativeText(3600, false), '1 hours ago');
  });
  test('일 단위', () => {
    assert.equal(formatRelativeText(86400, false), '1 days ago');
  });
  test('개월 단위', () => {
    assert.equal(formatRelativeText(2592000, false), '1 months ago');
  });
  test('년 단위', () => {
    assert.equal(formatRelativeText(31536000, false), '1 years ago');
  });
});

describe('formatRelativeText (한국어)', () => {
  test('경계값 한국어 문구', () => {
    assert.equal(formatRelativeText(0, true), '방금 전');
    assert.equal(formatRelativeText(120, true), '2분 전');
    assert.equal(formatRelativeText(7200, true), '2시간 전');
    assert.equal(formatRelativeText(172800, true), '2일 전');
    assert.equal(formatRelativeText(5184000, true), '2개월 전');
    assert.equal(formatRelativeText(63072000, true), '2년 전');
  });
});
