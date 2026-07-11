'use strict';

// ─────────────────────────────────────────────────────────────────────
// 런타임 공유 상태 — activate 에서 주입되는 값들의 단일 보관소.
//  - outputChannel: git 실행 로그 채널 (execGit 등이 참조)
//  - fullRefreshFn: 전체 트리 갱신 함수 (handleGitError 등이 참조)
//  - errorStatusItem: 하단 상태바 에러 표시 아이템 (showGitError 가 참조)
// 모듈 간 순환 require 없이 공유 상태를 전달하기 위한 얇은 레이어.
// ─────────────────────────────────────────────────────────────────────

let outputChannel = null;
let fullRefreshFn = null;
let errorStatusItem = null;

module.exports = {
  setOutputChannel(ch) { outputChannel = ch; },
  getOutputChannel() { return outputChannel; },
  setFullRefreshFn(fn) { fullRefreshFn = fn; },
  getFullRefreshFn() { return fullRefreshFn; },
  setErrorStatusItem(item) { errorStatusItem = item; },
  getErrorStatusItem() { return errorStatusItem; },
};
