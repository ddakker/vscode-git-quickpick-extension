'use strict';

// ─────────────────────────────────────────────────────────────────────
// git 실행 + 자격증명(askpass) 처리
//
//  - execGit/execGitSilent: git 자식 프로세스 실행 (로그/인증 재시도 포함)
//  - 자체 askpass: VS Code 내장 askpass 는 IPC 핸들이 필요해 외부 확장에서
//    재사용 불가. shell/JS askpass 를 만들어 env var 로 credential 전달.
//
// auth 실패 → credential 프롬프트 → 1회 재시도. retryWithCredentials 가
// execGit 을 다시 호출하므로 두 로직을 같은 모듈에 둬 순환 require 를 피한다.
// ─────────────────────────────────────────────────────────────────────

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { buildGitEnv, isAuthError, parseAuthTargetFromError } = require('../../lib/git-helpers');
const { t } = require('../i18n');
const runtime = require('../runtime');

const execFileAsync = promisify(execFile);

let _customAskpassPath = null;
const _credCache = new Map(); // host -> { username, password }

function ensureCustomAskpass(context) {
  if (_customAskpassPath && fs.existsSync(_customAskpassPath)) {
    return _customAskpassPath;
  }
  const dir = context.globalStorageUri
    ? context.globalStorageUri.fsPath
    : path.join(os.tmpdir(), 'git-reflow');
  fs.mkdirSync(dir, { recursive: true });

  const isWin = process.platform === 'win32';
  if (isWin) {
    // Windows: Node.js 스크립트 + 실행용 .bat wrapper
    const jsPath = path.join(dir, 'git-reflow-askpass.js');
    const jsScript = [
      'var p = (process.argv[2] || "").toLowerCase();',
      'var k = p.indexOf("username") !== -1',
      '  ? "GIT_REFLOW_USERNAME" : "GIT_REFLOW_PASSWORD";',
      'process.stdout.write(process.env[k] || "");',
    ].join('\n');
    fs.writeFileSync(jsPath, jsScript);

    const batPath = path.join(dir, 'git-reflow-askpass.bat');
    const nodePath = process.execPath.replace(/\\/g, '\\\\');
    const batScript = `@"${nodePath}" "${jsPath.replace(/\\/g, '\\\\')}" %*\r\n`;
    fs.writeFileSync(batPath, batScript);
    _customAskpassPath = batPath;
  } else {
    // macOS / Linux: shell 스크립트
    const askpassPath = path.join(dir, 'git-reflow-askpass.sh');
    const script = `#!/bin/sh
# git-reflow custom askpass — credentials passed via env vars
case "$1" in
  *[Uu]sername*) printf '%s' "$GIT_REFLOW_USERNAME" ;;
  *)             printf '%s' "$GIT_REFLOW_PASSWORD" ;;
esac
`;
    fs.writeFileSync(askpassPath, script);
    fs.chmodSync(askpassPath, 0o755);
    _customAskpassPath = askpassPath;
  }
  return _customAskpassPath;
}

async function promptCredentials(host, knownUsername) {
  let username = knownUsername;
  if (!username) {
    username = await vscode.window.showInputBox({
      prompt: t('authUsername', host),
      ignoreFocusOut: true,
    });
    if (!username) return null;
  }
  const password = await vscode.window.showInputBox({
    prompt: t('authPassword', username, host),
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) return null;
  return { username, password };
}

// auth 실패 시 credential 프롬프트 + 재시도 (HTTP(S) 원격에만 적용)
// 에러 메시지에서 URL을 직접 추출해 여러 remote 환경에서도 정확히 동작
async function retryWithCredentials(args, cwd, options, origErr) {
  const target = parseAuthTargetFromError(origErr);
  if (!target) throw origErr;

  const { host, username: urlUsername } = target;
  const cacheKey = urlUsername ? `${urlUsername}@${host}` : host;
  let creds = _credCache.get(cacheKey);
  if (!creds) {
    vscode.window.showInformationMessage(t('authRequired', host));
    creds = await promptCredentials(host, urlUsername);
    if (!creds) {
      vscode.window.showWarningMessage(t('authCancelled'));
      throw origErr;
    }
  }

  if (!_customAskpassPath) throw origErr;

  const authEnv = {
    ...buildGitEnv(),
    ...(options.env || {}),
    GIT_ASKPASS: _customAskpassPath,
    GIT_REFLOW_USERNAME: creds.username,
    GIT_REFLOW_PASSWORD: creds.password,
  };

  try {
    const result = await execGit(args, cwd, {
      ...options, env: authEnv, _noAuthRetry: true,
    });
    _credCache.set(cacheKey, creds);
    return result;
  } catch (retryErr) {
    if (isAuthError(retryErr)) _credCache.delete(cacheKey);
    throw retryErr;
  }
}

// 내부 헬퍼용 (로그 없이 실행 — status, rev-parse 등 빈번한 조회)
async function execGitSilent(args, cwd, options = {}) {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024,
    env: buildGitEnv(),
    ...options,
  });
}

// 사용자 명령용 (출력 로그에 기록 + 자동 표시)
// options._silent: true → outputChannel 로그/표시 생략 (백그라운드 조회용, auth retry는 유지)
async function execGit(args, cwd, options = {}) {
  const { _noAuthRetry, _silent, ...execOptions } = options;
  const outputChannel = runtime.getOutputChannel();
  const cmdStr = `git ${args.join(' ')}`;
  if (outputChannel && !_silent) {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    outputChannel.appendLine(`[${ts}] ${cmdStr}`);
    // 출력 패널 자동 표시는 하지 않음 — 하단에 열어둔 터미널이 멋대로 출력 로그로 전환되는 것 방지
    // (로그는 계속 기록되므로 필요하면 "출력" 패널에서 직접 확인 가능)
  }
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 1024 * 1024,
      env: buildGitEnv(),
      ...execOptions,
    });
    return result;
  } catch (err) {
    // 인증 에러면 credential 프롬프트 + 1회 재시도
    if (!_noAuthRetry && isAuthError(err)) {
      try {
        return await retryWithCredentials(args, cwd, { ...execOptions, _silent }, err);
      } catch (retryErr) {
        if (outputChannel && !_silent) {
          const errMsg = (retryErr.stderr || '') + (retryErr.stdout || '')
            || retryErr.message || String(retryErr);
          outputChannel.appendLine(`[ERROR] ${errMsg.trimEnd()}`);
          outputChannel.appendLine('');
        }
        throw retryErr;
      }
    }
    if (outputChannel && !_silent) {
      const errMsg = (err.stderr || '') + (err.stdout || '') || err.message || String(err);
      outputChannel.appendLine(`[ERROR] ${errMsg.trimEnd()}`);
      outputChannel.appendLine('');
    }
    throw err;
  }
}

module.exports = {
  execFileAsync,
  ensureCustomAskpass,
  execGit,
  execGitSilent,
};
