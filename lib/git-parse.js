'use strict';

// ─────────────────────────────────────────────────────────────────────
// git stdout 파서 — VS Code API 의존 없는 순수 함수 모음
//
// git 명령 출력(stdout)을 객체 배열로 변환한다. 네트워크/실행은 호출부 담당.
// vscode 스텁 없이 테스트 가능 (tests/parse-git-output.test.js, branch-parse.test.js).
// ─────────────────────────────────────────────────────────────────────

const { formatCommitDate } = require('./git-helpers');

// `git log --format=%H%x09%s%x09%an%x09%aI` 출력 파싱
// 각 줄: "<hash>\t<message>\t<author>\t<ISO date>" → [{ hash, message, author, date }]
function parseCommitLog(stdout) {
  if (!stdout || !stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [hash, message, author, dateISO] = line.split('\t');
    return { hash, message, author, date: formatCommitDate(dateISO) };
  });
}

// `git for-each-ref ... refs/heads/` 출력 파싱
// 각 줄: "<name>\t<subject>\t<relTime>" → [{ name, description }]
function parseLocalBranches(stdout) {
  if (!stdout || !stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [name, subject, relTime] = line.split('\t');
    return { name, description: `${subject} (${relTime})` };
  });
}

// `git for-each-ref ... refs/remotes/` 출력 파싱 (symref 제외)
// 각 줄: "<name>\t<subject>\t<relTime>\t<symref>" → Map<name, { name, description }>
function parseTrackedRemoteBranches(stdout) {
  const tracked = new Map();
  if (stdout && stdout.trim()) {
    for (const line of stdout.trim().split('\n')) {
      const [name, subject, relTime, symref] = line.split('\t');
      if (symref) continue; // origin/HEAD 등 심볼릭 ref 제외
      tracked.set(name, { name, description: `${subject} (${relTime})` });
    }
  }
  return tracked;
}

// 추적 중인 원격 브랜치 + ls-remote 로 발견한 미페치 브랜치를 합쳐 최종 목록 생성
// trackedMap: parseTrackedRemoteBranches 결과, remoteNameLists: lsRemoteHeads 결과 배열들,
// notFetchedLabel: t('notFetched') 주입값
function buildRemoteBranchList(trackedMap, remoteNameLists, notFetchedLabel) {
  const unfetched = [];
  for (const names of remoteNameLists) {
    for (const name of names) {
      if (!trackedMap.has(name)) {
        unfetched.push({ name, description: notFetchedLabel, unfetched: true });
      }
    }
  }
  unfetched.sort((a, b) => a.name.localeCompare(b.name));
  return [...trackedMap.values(), ...unfetched];
}

module.exports = {
  parseCommitLog,
  parseLocalBranches,
  parseTrackedRemoteBranches,
  buildRemoteBranchList,
};
