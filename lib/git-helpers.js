'use strict';

// ─────────────────────────────────────────────────────────────────────
// Git helpers — VS Code API 의존 없는 순수 함수 모음
//
// extension.js에서 `require('./lib/git-helpers')`로 사용.
// vscode 스텁 없이 테스트 가능 (tests/git-helpers.test.js).
// ─────────────────────────────────────────────────────────────────────

/**
 * git 자식 프로세스용 환경변수 빌더
 * - Fedora/KDE 환경이 상속시키는 GIT_ASKPASS=/usr/bin/ksshaskpass 차단
 * - SSH_ASKPASS 차단 (ksshaskpass SIGABRT 방지)
 * - TTY 프롬프트 차단 (askpass로만 credential 전달)
 */
function buildGitEnv() {
  const env = { ...process.env };
  env.SSH_ASKPASS = '';
  delete env.GIT_ASKPASS;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/** HTTP(S) URL 여부 */
function isHttpRemote(url) {
  return /^https?:\/\//i.test(url || '');
}

/**
 * git 에러 객체에서 인증 실패 패턴 감지
 * - Authentication failed / could not read Username|Password
 * - terminal prompts disabled
 * - ksshaskpass SIGABRT (Fedora/KDE)
 */
function isAuthError(err) {
  const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '');
  return /Authentication failed|could not read (Username|Password)|terminal prompts disabled|died of signal|ksshaskpass/i
    .test(msg);
}

/**
 * 에러 메시지에서 git이 접근하려 한 HTTP(S) URL을 파싱하여 host/username 추출
 * 예: "could not read Password for 'http://user@host:port'" → { host, username: 'user' }
 *     "Authentication failed for 'http://host/path'"        → { host, username: null }
 * SSH(scp-style)이나 URL이 없으면 null 반환
 */
function parseAuthTargetFromError(err) {
  const msg = (err.stderr || '') + (err.stdout || '') + (err.message || '');
  const m = msg.match(/https?:\/\/[^\s'"]+/);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    return {
      host: u.host,
      username: u.username ? decodeURIComponent(u.username) : null,
    };
  } catch {
    return null;
  }
}

/** git merge/rebase 출력에서 충돌 감지 */
function isConflict(errorMsg) {
  return /CONFLICT|MERGE_CONFLICT|merge conflict/i.test(errorMsg);
}

/**
 * ISO 날짜 문자열을 "YYYY-MM-DD AM/PM HH:mm" 로컬 포맷으로 변환
 * 사이드바 커밋 히스토리 표시용
 */
function formatCommitDate(isoDate) {
  const d = new Date(isoDate);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const hh = String(h % 12 || 12).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${ampm} ${hh}:${mm}`;
}

module.exports = {
  buildGitEnv,
  isHttpRemote,
  isAuthError,
  parseAuthTargetFromError,
  isConflict,
  formatCommitDate,
};
