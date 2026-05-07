'use strict';

// ─────────────────────────────────────────────────────────────────────
// extension.js의 i18n (t 함수) 테스트
// extension.js 로드에 vscode 스텁 필요
// ─────────────────────────────────────────────────────────────────────

require('./vscode-stub');

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ext = require(path.resolve(__dirname, '..', 'extension.js'));
const { t } = ext._internals;

describe('t (i18n)', () => {
  test('returns English text (stub uses language=en)', () => {
    assert.equal(t('noBranches'), 'No branches available.');
  });

  test('substitutes {0} placeholder', () => {
    assert.equal(t('authUsername', 'github.com'), 'Username for github.com');
  });

  test('substitutes multiple placeholders {0}, {1}', () => {
    assert.equal(
      t('authPassword', 'ddakker', 'github.com'),
      'Password for ddakker@github.com',
    );
  });

  test('returns key itself for unknown message (graceful fallback)', () => {
    assert.equal(t('nonExistentKeyXYZ'), 'nonExistentKeyXYZ');
  });
});

describe('extension module exports', () => {
  test('activate and deactivate are functions', () => {
    assert.equal(typeof ext.activate, 'function');
    assert.equal(typeof ext.deactivate, 'function');
  });

  test('_internals exposes t function for tests', () => {
    assert.equal(typeof ext._internals.t, 'function');
  });
});
