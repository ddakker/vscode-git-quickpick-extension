'use strict';

// ─────────────────────────────────────────────────────────────────────
// 커밋 표시 포맷 — VS Code API 의존 없는 순수 함수 모음
//
// 트리뷰/QuickPick 의 커밋 라벨·설명·툴팁을 만든다.
// vscode 스텁 없이 테스트 가능 (tests/format-commit.test.js).
// ─────────────────────────────────────────────────────────────────────

// 커밋 표시 필드별 값 추출기 (설정 commitFieldOrder 의 키와 1:1)
const COMMIT_FIELD_VALUE = {
  message: c => c.message,
  author:  c => c.author,
  date:    c => c.date,
  hash:    c => c.hash.substring(0, 8),
};

// 필드별 고정 글자폭 — 메시지는 가변, 나머지는 칸 정렬용 고정폭
// (트리뷰 description 은 가변폭 폰트라 완벽 정렬은 아니고 글자수 기준 근사 정렬)
const COMMIT_FIELD_WIDTH = { author: 10, date: 19, hash: 8 };

const DEFAULT_FIELD_ORDER = ['message', 'date', 'author', 'hash'];

// 텍스트를 지정 글자폭에 맞춤 — 길면 …로 자르고, 짧으면 공백으로 채움
function fitWidth(text, width) {
  const s = String(text);
  if (!width) return s;
  if (s.length > width) return s.substring(0, width - 1) + '…';
  return s.padEnd(width, ' ');
}

// 설정 문자열(콤마 구분)을 유효 키 배열로 파싱. 유효 키가 없으면 기본 순서 반환.
function resolveCommitFieldOrder(raw, defaultOrder = DEFAULT_FIELD_ORDER) {
  const value = raw == null ? defaultOrder.join(',') : raw;
  const fields = value.split(',').map(s => s.trim()).filter(f => COMMIT_FIELD_VALUE[f]);
  return fields.length ? fields : defaultOrder;
}

// 커밋 → 표시값 — 첫 필드는 밝은 label(폭 고정 안 함), 나머지는 흐린 description
function formatCommitFields(c, fieldOrder, widthMap = COMMIT_FIELD_WIDTH) {
  const [first, ...rest] = fieldOrder;
  return {
    label: COMMIT_FIELD_VALUE[first](c),
    description: rest.map(f => fitWidth(COMMIT_FIELD_VALUE[f](c), widthMap[f])).join('  '),
  };
}

// 커밋 항목 툴팁 — 날짜 / 작성자 / 해시 / 메시지 순. 라벨은 i18n 결과를 주입받는다.
function buildCommitTooltip(c, labels) {
  return [
    `${labels.date}: ${c.date}`,
    `${labels.author}: ${c.author}`,
    `${labels.hash}: ${c.hash}`,
    `${labels.message}: ${c.message}`,
  ].join('\n');
}

module.exports = {
  COMMIT_FIELD_VALUE,
  COMMIT_FIELD_WIDTH,
  DEFAULT_FIELD_ORDER,
  fitWidth,
  resolveCommitFieldOrder,
  formatCommitFields,
  buildCommitTooltip,
};
