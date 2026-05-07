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
  formatCommitDate,
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
