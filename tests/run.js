'use strict';

// ─────────────────────────────────────────────────────────────────────
// 테스트 엔트리 포인트
// 실행: npm test  또는  node tests/run.js
//
// tests/*.test.js 파일을 모두 require하여 일괄 실행. node:test는 require된
// describe/test를 자동으로 수집해 프로세스 종료 시 TAP 리포트를 출력한다.
// ─────────────────────────────────────────────────────────────────────

// i18n 테스트는 extension.js를 require하므로 vscode 스텁이 먼저 설정되어야 함.
// 하지만 git-helpers.test.js는 스텁 없이도 동작. i18n.test.js 내부에서
// require('./vscode-stub')을 하지만 Module._resolveFilename 패치는 전역이므로
// 순서는 무관.

require('./git-helpers.test');
require('./i18n.test');
require('./get-current-branch.test');
require('./file-status-letter.test');
