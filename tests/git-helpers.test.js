'use strict';

// ─────────────────────────────────────────────────────────────────────
// lib/git-helpers.js — 순수 함수 유닛 테스트
// vscode 스텁 불필요 (의존성 없음)
// ─────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGitEnv,
  isHttpRemote,
  isAuthError,
  parseAuthTargetFromError,
  isConflict,
  isUnmergedStatus,
  formatCommitDate,
  formatBackupTimestamp,
  buildRebaseBackupName,
  parseBackupTimestamp,
  backupGroupKey,
  selectStaleBackups,
  parseStashList,
  parseNameStatus,
} = require('../lib/git-helpers');

// ─── isAuthError ──────────────────────────────────────────────────

describe('isAuthError', () => {
  test('detects "Authentication failed"', () => {
    assert.equal(
      isAuthError({ stderr: "fatal: Authentication failed for 'http://host/repo'" }),
      true,
    );
  });

  test('detects "could not read Username"', () => {
    assert.equal(
      isAuthError({ stderr: "fatal: could not read Username for 'http://host'" }),
      true,
    );
  });

  test('detects "could not read Password"', () => {
    assert.equal(
      isAuthError({ stderr: "fatal: could not read Password for 'http://user@host'" }),
      true,
    );
  });

  test('detects ksshaskpass SIGABRT failure (Fedora/KDE regression)', () => {
    assert.equal(
      isAuthError({ stderr: 'error: /usr/bin/ksshaskpass died of signal 6' }),
      true,
    );
  });

  test('detects "terminal prompts disabled"', () => {
    assert.equal(
      isAuthError({ stderr: 'fatal: could not read Password: terminal prompts disabled' }),
      true,
    );
  });

  test('reads from stdout when stderr is empty', () => {
    assert.equal(
      isAuthError({ stdout: 'Authentication failed', stderr: '' }),
      true,
    );
  });

  test('reads from message field as fallback', () => {
    assert.equal(isAuthError({ message: 'Authentication failed' }), true);
  });

  test('returns false for non-auth errors', () => {
    assert.equal(isAuthError({ stderr: 'fatal: not a git repository' }), false);
    assert.equal(
      isAuthError({ stderr: 'error: Your local changes would be overwritten' }),
      false,
    );
    assert.equal(
      isAuthError({ stderr: 'CONFLICT (content): Merge conflict in foo.js' }),
      false,
    );
  });

  test('returns false for empty error object', () => {
    assert.equal(isAuthError({}), false);
  });
});

// ─── parseAuthTargetFromError ─────────────────────────────────────

describe('parseAuthTargetFromError', () => {
  test('extracts host and username from http URL with credentials', () => {
    const err = {
      stderr: "fatal: could not read Password for 'http://ddakker@bitbucket.dev.opennaru.com:7990'",
    };
    assert.deepEqual(parseAuthTargetFromError(err), {
      host: 'bitbucket.dev.opennaru.com:7990',
      username: 'ddakker',
    });
  });

  test('extracts host only when URL has no username', () => {
    const err = {
      stderr: "fatal: Authentication failed for 'http://bitbucket.dev.opennaru.com:7990/scm/foo/bar.git'",
    };
    assert.deepEqual(parseAuthTargetFromError(err), {
      host: 'bitbucket.dev.opennaru.com:7990',
      username: null,
    });
  });

  test('handles https URLs', () => {
    const err = {
      stderr: "fatal: could not read Password for 'https://user@github.com'",
    };
    assert.deepEqual(parseAuthTargetFromError(err), {
      host: 'github.com',
      username: 'user',
    });
  });

  test('decodes URL-encoded username', () => {
    const err = {
      stderr: "fatal: could not read Password for 'https://user%40domain.com@github.com'",
    };
    assert.deepEqual(parseAuthTargetFromError(err), {
      host: 'github.com',
      username: 'user@domain.com',
    });
  });

  test('returns null for SSH URLs (scp-style)', () => {
    const err = {
      stderr: 'fatal: Could not read from remote repository git@github.com:user/repo.git',
    };
    assert.equal(parseAuthTargetFromError(err), null);
  });

  test('returns null when no URL in error message', () => {
    assert.equal(
      parseAuthTargetFromError({ stderr: 'fatal: not a git repository' }),
      null,
    );
  });

  test('returns null for empty error', () => {
    assert.equal(parseAuthTargetFromError({}), null);
  });

  test('handles URL followed by quote and locale text (Korean)', () => {
    const err = {
      stderr: "fatal: could not read Password for 'http://ddakker@bitbucket.dev.opennaru.com:7990': 그런 장치 혹은 주소가 없음",
    };
    assert.deepEqual(parseAuthTargetFromError(err), {
      host: 'bitbucket.dev.opennaru.com:7990',
      username: 'ddakker',
    });
  });
});

// ─── isHttpRemote ─────────────────────────────────────────────────

describe('isHttpRemote', () => {
  test('returns true for http', () => {
    assert.equal(isHttpRemote('http://host/repo'), true);
  });

  test('returns true for https', () => {
    assert.equal(isHttpRemote('https://host/repo'), true);
  });

  test('is case insensitive', () => {
    assert.equal(isHttpRemote('HTTP://host/repo'), true);
    assert.equal(isHttpRemote('HTTPS://host/repo'), true);
  });

  test('returns false for scp-style SSH URLs', () => {
    assert.equal(isHttpRemote('git@github.com:user/repo.git'), false);
  });

  test('returns false for ssh:// URLs', () => {
    assert.equal(isHttpRemote('ssh://git@host/repo.git'), false);
  });

  test('returns false for file:// URLs', () => {
    assert.equal(isHttpRemote('file:///home/user/repo'), false);
  });

  test('returns false for null/undefined/empty', () => {
    assert.equal(isHttpRemote(null), false);
    assert.equal(isHttpRemote(undefined), false);
    assert.equal(isHttpRemote(''), false);
  });
});

// ─── buildGitEnv ──────────────────────────────────────────────────

describe('buildGitEnv', () => {
  test('clears SSH_ASKPASS to block ksshaskpass inheritance', () => {
    const orig = process.env.SSH_ASKPASS;
    process.env.SSH_ASKPASS = '/usr/bin/ksshaskpass';
    try {
      assert.equal(buildGitEnv().SSH_ASKPASS, '');
    } finally {
      if (orig === undefined) delete process.env.SSH_ASKPASS;
      else process.env.SSH_ASKPASS = orig;
    }
  });

  test('removes GIT_ASKPASS even if set to ksshaskpass', () => {
    const orig = process.env.GIT_ASKPASS;
    process.env.GIT_ASKPASS = '/usr/bin/ksshaskpass';
    try {
      assert.equal(buildGitEnv().GIT_ASKPASS, undefined);
    } finally {
      if (orig === undefined) delete process.env.GIT_ASKPASS;
      else process.env.GIT_ASKPASS = orig;
    }
  });

  test('sets GIT_TERMINAL_PROMPT to "0"', () => {
    assert.equal(buildGitEnv().GIT_TERMINAL_PROMPT, '0');
  });

  test('preserves unrelated env vars', () => {
    process.env.GIT_REFLOW_TEST_VAR = 'preserved-value';
    try {
      assert.equal(buildGitEnv().GIT_REFLOW_TEST_VAR, 'preserved-value');
    } finally {
      delete process.env.GIT_REFLOW_TEST_VAR;
    }
  });

  test('returns a fresh object (no cross-call mutation)', () => {
    const env1 = buildGitEnv();
    env1._mutated = 'should-not-persist';
    const env2 = buildGitEnv();
    assert.equal(env2._mutated, undefined);
  });
});

// ─── isConflict ───────────────────────────────────────────────────

describe('isConflict', () => {
  test('detects "CONFLICT (content)"', () => {
    assert.equal(isConflict('CONFLICT (content): Merge conflict in foo.js'), true);
  });

  test('detects "CONFLICT (add/add)"', () => {
    assert.equal(isConflict('CONFLICT (add/add): Merge conflict in foo.js'), true);
  });

  test('detects "MERGE_CONFLICT"', () => {
    assert.equal(isConflict('MERGE_CONFLICT'), true);
  });

  test('detects lowercase "merge conflict"', () => {
    assert.equal(
      isConflict('Automatic merge failed; fix conflicts: merge conflict'),
      true,
    );
  });

  test('returns false for non-conflict errors', () => {
    assert.equal(isConflict('fatal: not a git repository'), false);
    assert.equal(isConflict('fatal: Authentication failed'), false);
    assert.equal(isConflict(''), false);
  });
});

// ─── isUnmergedStatus ─────────────────────────────────────────────
// git status --porcelain의 두 상태 글자(index, work)로 충돌(unmerged) 판정

describe('isUnmergedStatus', () => {
  test('detects all 7 unmerged porcelain codes', () => {
    // [index, work] 쌍: DD/AU/UD/UA/DU/AA/UU
    const codes = [
      ['D', 'D'], ['A', 'U'], ['U', 'D'],
      ['U', 'A'], ['D', 'U'], ['A', 'A'], ['U', 'U'],
    ];
    for (const [x, y] of codes) {
      assert.equal(isUnmergedStatus(x, y), true, `${x}${y} 는 충돌이어야 함`);
    }
  });

  test('returns false for normal (non-conflict) statuses', () => {
    // 정상 추가/수정/삭제/이름변경/untracked — 충돌 아님
    const codes = [
      ['A', 'M'], ['A', ' '], [' ', 'M'], ['M', ' '],
      ['M', 'M'], ['D', ' '], [' ', 'D'], ['R', ' '], ['?', '?'],
    ];
    for (const [x, y] of codes) {
      assert.equal(isUnmergedStatus(x, y), false, `${x}${y} 는 충돌이 아니어야 함`);
    }
  });
});

// ─── formatCommitDate ─────────────────────────────────────────────

describe('formatCommitDate', () => {
  test('formats ISO date as "YYYY-MM-DD AM/PM HH:mm"', () => {
    // 로컬 시간대 무관 테스트를 위해 시간 문자열만 사용
    const result = formatCommitDate('2026-04-07T14:30:00');
    assert.match(result, /^2026-04-07 PM 02:30$/);
  });

  test('formats AM times correctly', () => {
    assert.match(formatCommitDate('2026-04-07T08:45:00'), /^2026-04-07 AM 08:45$/);
  });

  test('handles midnight as 12 AM', () => {
    assert.match(formatCommitDate('2026-04-07T00:00:00'), /^2026-04-07 AM 12:00$/);
  });

  test('handles noon as 12 PM', () => {
    assert.match(formatCommitDate('2026-04-07T12:00:00'), /^2026-04-07 PM 12:00$/);
  });

  test('pads single-digit month/day/hour/minute', () => {
    assert.match(formatCommitDate('2026-01-05T03:07:00'), /^2026-01-05 AM 03:07$/);
  });
});

// ─── formatBackupTimestamp / buildRebaseBackupName ────────────────

describe('formatBackupTimestamp', () => {
  test('formats as YYYYMMDD-HHmmss', () => {
    const d = new Date(2026, 5, 1, 15, 30, 5); // 2026-06-01 15:30:05 (local)
    assert.equal(formatBackupTimestamp(d), '20260601-153005');
  });

  test('pads single-digit fields', () => {
    const d = new Date(2026, 0, 5, 3, 7, 9); // 2026-01-05 03:07:09
    assert.equal(formatBackupTimestamp(d), '20260105-030709');
  });
});

describe('buildRebaseBackupName', () => {
  test('builds backup/<branch>/<timestamp>', () => {
    const d = new Date(2026, 5, 1, 15, 30, 5);
    assert.equal(buildRebaseBackupName('feature-login', d), 'backup/feature-login/20260601-153005');
  });

  test('keeps slashes in branch name (nested refs)', () => {
    const d = new Date(2026, 5, 1, 15, 30, 5);
    assert.equal(buildRebaseBackupName('feature/login', d), 'backup/feature/login/20260601-153005');
  });
});

// ─── parseBackupTimestamp / backupGroupKey ──────────────────────────
describe('parseBackupTimestamp', () => {
  test('parses trailing YYYYMMDD-HHmmss into a Date', () => {
    const d = parseBackupTimestamp('backup/main/20260601-153005');
    assert.deepEqual(d, new Date(2026, 5, 1, 15, 30, 5));
  });

  test('works with nested branch names', () => {
    const d = parseBackupTimestamp('backup/feature/login/20260105-030709');
    assert.deepEqual(d, new Date(2026, 0, 5, 3, 7, 9));
  });

  test('returns null when no timestamp suffix', () => {
    assert.equal(parseBackupTimestamp('backup/main'), null);
    assert.equal(parseBackupTimestamp('feature/login'), null);
    assert.equal(parseBackupTimestamp(''), null);
  });
});

describe('backupGroupKey', () => {
  test('strips trailing timestamp', () => {
    assert.equal(backupGroupKey('backup/main/20260601-153005'), 'backup/main');
    assert.equal(backupGroupKey('backup/feature/login/20260105-030709'), 'backup/feature/login');
  });

  test('returns null when not a backup-with-timestamp name', () => {
    assert.equal(backupGroupKey('backup/main'), null);
  });
});

// ─── selectStaleBackups ─────────────────────────────────────────────
describe('selectStaleBackups', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15 12:00

  test('keeps most-recent maxKeep per group, deletes the rest (no age limit)', () => {
    const names = [
      'backup/main/20260601-100000',
      'backup/main/20260602-100000',
      'backup/main/20260603-100000',
    ];
    const stale = selectStaleBackups(names, { maxKeep: 2, maxAgeDays: 0, now });
    assert.deepEqual(stale, ['backup/main/20260601-100000']); // 가장 오래된 1개
  });

  test('counts each branch group independently', () => {
    const names = [
      'backup/main/20260601-100000',
      'backup/main/20260602-100000',
      'backup/feature/20260601-100000', // 그룹에 1개뿐 → cap=1 안에 들어 보존
    ];
    const stale = selectStaleBackups(names, { maxKeep: 1, maxAgeDays: 0, now });
    assert.deepEqual(stale, ['backup/main/20260601-100000']);
  });

  test('age limit deletes old backups even within the keep count', () => {
    const names = [
      'backup/main/20260101-100000', // 오래됨 (30일 초과)
      'backup/main/20260615-100000', // 최근
    ];
    // maxKeep=5 → 둘 다 개수 안엔 들지만, 오래된 건 기간 기준으로 삭제
    const stale = selectStaleBackups(names, { maxKeep: 5, maxAgeDays: 30, now });
    assert.deepEqual(stale, ['backup/main/20260101-100000']);
  });

  test('union of count and age (either condition deletes)', () => {
    const names = [
      'backup/main/20260615-100000', // 최근, 보존
      'backup/main/20260610-100000', // 최근이지만 cap 초과
      'backup/main/20260101-100000', // 오래됨 + cap 초과
    ];
    const stale = selectStaleBackups(names, { maxKeep: 1, maxAgeDays: 30, now });
    assert.deepEqual(stale.sort(), ['backup/main/20260101-100000', 'backup/main/20260610-100000'].sort());
  });

  test('ignores names without a valid timestamp', () => {
    const names = ['backup/main', 'feature/x', 'backup/main/20260101-100000'];
    const stale = selectStaleBackups(names, { maxKeep: 0, maxAgeDays: 30, now });
    assert.deepEqual(stale, ['backup/main/20260101-100000']);
  });

  test('no limits → nothing deleted', () => {
    const names = ['backup/main/20200101-100000'];
    assert.deepEqual(selectStaleBackups(names, { maxKeep: 0, maxAgeDays: 0, now }), []);
  });

  test('handles empty / nullish input', () => {
    assert.deepEqual(selectStaleBackups([], { maxKeep: 1, now }), []);
    assert.deepEqual(selectStaleBackups(undefined, { maxKeep: 1, now }), []);
  });
});

// ─── parseStashList ───────────────────────────────────────────────

describe('parseStashList', () => {
  test('parses ref/message/relTime per line', () => {
    const out = 'stash@{0}\tWIP on main: 1234 fix bug\t2 hours ago\n'
      + 'stash@{1}\tOn feature: my stash\t3 days ago';
    assert.deepEqual(parseStashList(out), [
      { ref: 'stash@{0}', index: 0, message: 'WIP on main: 1234 fix bug', relTime: '2 hours ago' },
      { ref: 'stash@{1}', index: 1, message: 'On feature: my stash', relTime: '3 days ago' },
    ]);
  });

  test('empty / nullish input → []', () => {
    assert.deepEqual(parseStashList(''), []);
    assert.deepEqual(parseStashList('   '), []);
    assert.deepEqual(parseStashList(undefined), []);
  });

  test('ignores lines without a valid stash ref', () => {
    const out = 'garbage line\nstash@{0}\tmsg\tnow';
    assert.deepEqual(parseStashList(out), [
      { ref: 'stash@{0}', index: 0, message: 'msg', relTime: 'now' },
    ]);
  });

  test('tolerates missing message / relTime columns', () => {
    assert.deepEqual(parseStashList('stash@{2}'), [
      { ref: 'stash@{2}', index: 2, message: '', relTime: '' },
    ]);
  });
});

// ─── parseNameStatus ──────────────────────────────────────────────

describe('parseNameStatus', () => {
  test('parses status letter + path per line', () => {
    const out = 'M\tsrc/app.js\nA\tlib/new.js\nD\told.txt';
    assert.deepEqual(parseNameStatus(out), [
      { statusCode: 'M', filePath: 'src/app.js' },
      { statusCode: 'A', filePath: 'lib/new.js' },
      { statusCode: 'D', filePath: 'old.txt' },
    ]);
  });

  test('empty / nullish input → []', () => {
    assert.deepEqual(parseNameStatus(''), []);
    assert.deepEqual(parseNameStatus('   '), []);
    assert.deepEqual(parseNameStatus(undefined), []);
  });

  test('keeps only the first status char and preserves tabbed paths', () => {
    assert.deepEqual(parseNameStatus('MM\tdir/with\ttab.js'), [
      { statusCode: 'M', filePath: 'dir/with\ttab.js' },
    ]);
  });
});
