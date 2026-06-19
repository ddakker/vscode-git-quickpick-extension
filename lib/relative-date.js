'use strict';

// ─────────────────────────────────────────────────────────────────────
// 상대 시간 표시 — VS Code API 의존 없는 순수 함수
//
// blame 인라인 표시용. "방금 전 / N분 전 / N시간 전 ..." 문구를 만든다.
// vscode 스텁 없이 테스트 가능 (tests/relative-date.test.js).
// ─────────────────────────────────────────────────────────────────────

// 경과 초(diff)를 사람이 읽는 상대 시간 문구로 변환. isKo=true 면 한국어.
function formatRelativeText(diff, isKo) {
  if (diff < 60) return isKo ? '방금 전' : 'just now';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return isKo ? `${m}분 전` : `${m} min ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return isKo ? `${h}시간 전` : `${h} hours ago`;
  }
  if (diff < 2592000) {
    const d = Math.floor(diff / 86400);
    return isKo ? `${d}일 전` : `${d} days ago`;
  }
  if (diff < 31536000) {
    const mo = Math.floor(diff / 2592000);
    return isKo ? `${mo}개월 전` : `${mo} months ago`;
  }
  const y = Math.floor(diff / 31536000);
  return isKo ? `${y}년 전` : `${y} years ago`;
}

module.exports = { formatRelativeText };
