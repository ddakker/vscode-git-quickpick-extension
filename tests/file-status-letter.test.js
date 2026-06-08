'use strict';

// ─────────────────────────────────────────────────────────────────────
// fileStatusLetter 단위 테스트
// 커밋 섹션 파일 목록에 표시할 상태 글자 변환 규칙 검증.
// M(수정)→U, A/?(신규)→A, D(삭제)→D, 그 외는 원본 코드 그대로.
//
// extension.js 로드에 vscode 스텁 필요
// ─────────────────────────────────────────────────────────────────────

require('./vscode-stub');

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ext = require(path.resolve(__dirname, '..', 'extension.js'));
const { fileStatusLetter } = ext._internals;

describe('fileStatusLetter', () => {
  test('수정(M)은 U로 표시한다', () => {
    assert.equal(fileStatusLetter('M'), 'U');
  });

  test('스테이지된 신규(A)는 A로 표시한다', () => {
    assert.equal(fileStatusLetter('A'), 'A');
  });

  test('미추적(?)도 신규이므로 A로 표시한다', () => {
    assert.equal(fileStatusLetter('?'), 'A');
  });

  test('삭제(D)는 D로 표시한다', () => {
    assert.equal(fileStatusLetter('D'), 'D');
  });

  test('그 외 코드는 원본을 그대로 반환한다', () => {
    assert.equal(fileStatusLetter('C'), 'C');
    assert.equal(fileStatusLetter('T'), 'T');
  });
});
