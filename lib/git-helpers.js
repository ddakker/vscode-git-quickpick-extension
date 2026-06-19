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
 * `git status --porcelain`의 두 상태 글자(index, work)가 unmerged(충돌) 상태인지 판정.
 * 충돌 코드: DD/AU/UD/UA/DU/AA/UU (둘 중 하나가 'U'거나, AA/DD)
 * 주의: 이름이 비슷한 isConflict(에러 메시지 검사)와는 별개의 함수다.
 */
function isUnmergedStatus(indexStatus, workStatus) {
  return indexStatus === 'U' || workStatus === 'U'
    || (indexStatus === 'A' && workStatus === 'A')
    || (indexStatus === 'D' && workStatus === 'D');
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

// rebase 백업 브랜치 네이밍용 타임스탬프 (YYYYMMDD-HHmmss)
function formatBackupTimestamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// rebase 직전 복구용 백업 브랜치 이름 생성
function buildRebaseBackupName(branch, d = new Date()) {
  return `backup/${branch}/${formatBackupTimestamp(d)}`;
}

// 백업 브랜치 이름 끝의 타임스탬프(YYYYMMDD-HHmmss)를 Date 로 파싱. 형식이 아니면 null.
function parseBackupTimestamp(name) {
  const m = /\/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, s);
  return isNaN(dt.getTime()) ? null : dt;
}

// 백업 브랜치명에서 그룹 키(backup/<branch>) 추출. 끝의 타임스탬프 부분 제거. 형식 아니면 null.
function backupGroupKey(name) {
  const m = /^(.*)\/\d{8}-\d{6}$/.exec(name || '');
  return m ? m[1] : null;
}

// 삭제 대상(오래된) 백업 브랜치 이름 목록을 반환한다.
// 그룹(backup/<branch>)별로 다음 둘 중 하나라도 해당하면 삭제 대상(합집합):
//   - 최신 maxKeep개를 초과한 것  (개수 cap, 0 = 개수 제한 없음)
//   - maxAgeDays일보다 오래된 것  (기간,     0 = 기간 제한 없음)
// 둘 다 0이면 아무것도 삭제하지 않는다. 타임스탬프 형식이 아닌 이름은 절대 건드리지 않는다(안전).
// opts: { maxKeep, maxAgeDays, now }
function selectStaleBackups(names, opts = {}) {
  const maxKeep = opts.maxKeep || 0;
  const maxAgeDays = opts.maxAgeDays || 0;
  const now = opts.now || new Date();
  const ageMs = maxAgeDays > 0 ? maxAgeDays * 86400000 : null;

  const groups = new Map();
  for (const name of names || []) {
    const ts = parseBackupTimestamp(name);
    if (!ts) continue;
    // ts 가 있으면 같은 타임스탬프 접미사를 요구하는 backupGroupKey 도 항상 성공한다.
    const key = backupGroupKey(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name, ts });
  }

  const stale = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => b.ts - a.ts); // 최신 먼저
    entries.forEach((e, i) => {
      const tooMany = maxKeep > 0 && i >= maxKeep;          // 최신 maxKeep개 초과
      const tooOld = ageMs != null && now - e.ts > ageMs;   // maxAgeDays일 초과
      if (tooMany || tooOld) stale.push(e.name);
    });
  }
  return stale;
}

// `git stash list --format=%gd%x09%s%x09%cr` 출력을 파싱한다.
// 각 줄: "stash@{0}\t<메시지>\t<상대시간>"
// 반환: [{ ref, index, message, relTime }]  (형식이 아닌 줄은 제외)
function parseStashList(stdout) {
  if (!stdout || !stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [ref, message, relTime] = line.split('\t');
    const m = /stash@\{(\d+)\}/.exec(ref || '');
    return {
      ref: ref || '',
      index: m ? Number(m[1]) : null,
      message: message || '',
      relTime: relTime || '',
    };
  }).filter(s => s.ref && s.index !== null);
}

// `git ... --name-status` 출력을 파싱한다 (--no-renames 가정).
// 각 줄: "<status>\t<path>"  → [{ statusCode, filePath }]  (빈 줄 제외)
function parseNameStatus(stdout) {
  if (!stdout || !stdout.trim()) return [];
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split('\t');
    return { statusCode: (parts[0] || '')[0] || '', filePath: parts.slice(1).join('\t') };
  });
}

module.exports = {
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
};
