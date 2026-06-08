'use strict';

// ─────────────────────────────────────────────────────────────────────
// getCurrentBranch 회귀 테스트
// 커밋이 하나도 없는(unborn) 저장소에서 getCurrentBranch 가 예외를 던지면
// _fetchStatus 가 catch 로 빠져 _checkedFiles 를 비워버리고, 결과적으로
// "Select All" 이 동작하지 않는 버그가 있었다. unborn 저장소에서도 브랜치
// 이름을 정상 반환하는지 검증한다.
//
// extension.js 로드에 vscode 스텁 필요
// ─────────────────────────────────────────────────────────────────────

require('./vscode-stub');

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ext = require(path.resolve(__dirname, '..', 'extension.js'));
const { getCurrentBranch } = ext._internals;

function git(cwd, args) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

describe('getCurrentBranch', () => {
  let repo;

  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'reflow-branch-'));
    git(repo, ['init', '-q', '-b', 'main']);
  });

  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('커밋이 없는 저장소에서도 브랜치 이름을 반환한다 (예외 X)', async () => {
    // 수정 전: rev-parse --abbrev-ref HEAD 가 exit 128 로 실패해 throw 했음
    const branch = await getCurrentBranch(repo);
    assert.equal(branch, 'main');
  });

  test('커밋 후에도 정상 동작한다', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello');
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
    const branch = await getCurrentBranch(repo);
    assert.equal(branch, 'main');
  });
});
