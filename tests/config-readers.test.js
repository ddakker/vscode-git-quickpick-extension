'use strict';

// ─────────────────────────────────────────────────────────────────────
// 설정 readers 테스트 — extension.js 의 config 래퍼가 기본값/폴백을 지키는지.
// vscode 스텁의 getConfiguration 을 제어 가능한 가짜로 교체해 검증한다.
// (extension.js 로드에 vscode 스텁 필요)
// ─────────────────────────────────────────────────────────────────────

const stub = require('./vscode-stub');

// 가짜 설정 저장소 — get(key, default) 는 값이 있으면 반환, 없으면 default
let fakeConfig = {};
stub.workspace.getConfiguration = () => ({
  get: (key, def) => (key in fakeConfig ? fakeConfig[key] : def),
  update: () => Promise.resolve(),
  has: () => false,
  inspect: () => undefined,
});

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ext = require(path.resolve(__dirname, '..', 'extension.js'));
const {
  changesViewMode, isRebaseBackupEnabled, getBackupMaxKeep, getBackupMaxAgeDays,
} = ext._internals;

beforeEach(() => { fakeConfig = {}; });

describe('changesViewMode', () => {
  test('미설정 시 기본값 workspace', () => {
    assert.equal(changesViewMode(), 'workspace');
  });
  test('설정값을 반환', () => {
    fakeConfig.changesViewMode = 'separate';
    assert.equal(changesViewMode(), 'separate');
  });
});

describe('backup readers', () => {
  test('기본값: 백업 켜짐 / maxKeep 10 / maxAgeDays 30', () => {
    assert.equal(isRebaseBackupEnabled(), true);
    assert.equal(getBackupMaxKeep(), 10);
    assert.equal(getBackupMaxAgeDays(), 30);
  });
  test('설정값 반영', () => {
    fakeConfig.backupBeforeRebase = false;
    fakeConfig.backupMaxKeep = 3;
    fakeConfig.backupMaxAgeDays = 7;
    assert.equal(isRebaseBackupEnabled(), false);
    assert.equal(getBackupMaxKeep(), 3);
    assert.equal(getBackupMaxAgeDays(), 7);
  });
});

// 커밋 필드 순서/라벨 포맷 로직은 lib/commit-format.js 로 이전 → format-commit.test.js 가 검증.
// (히스토리/브랜치 webview 가 lib/webview-html.js 를 통해 사용)
