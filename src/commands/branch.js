'use strict';

// 브랜치 명령 — 생성/전환/삭제(로컬·원격).

const vscode = require('vscode');
const { t, isKo } = require('../i18n');
const { execGit } = require('../git/exec');
const { validateGitWorkspace } = require('../workspace');
const { getCurrentBranch, ensureRemoteBranchFetched, localBranchExists } = require('../git/queries');

async function execDeleteBranch(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const confirm = await vscode.window.showWarningMessage(
    t('confirmDeleteBranch', branchName),
    { modal: true, detail: t('deleteBranchDetail') },
    t('delete')
  );
  if (confirm !== t('delete')) return;

  try {
    await execGit(['branch', '-d', branchName], cwd);
    vscode.window.showInformationMessage(t('deleteBranchSuccess', branchName));
  } catch (err) {
    const msg = (err.stderr || err.message || String(err)).trim();
    // 머지되지 않은 브랜치 → 강제 삭제 여부 재확인
    if (/not fully merged/i.test(msg)) {
      const force = await vscode.window.showWarningMessage(
        t('confirmForceDeleteBranch', branchName),
        { modal: true, detail: t('forceDeleteBranchDetail') },
        t('forceDelete')
      );
      if (force !== t('forceDelete')) return;
      try {
        await execGit(['branch', '-D', branchName], cwd);
        vscode.window.showInformationMessage(t('deleteBranchSuccess', branchName));
      } catch (err2) {
        vscode.window.showErrorMessage(t('failed', (err2.stderr || err2.message || String(err2)).trim()));
      }
    } else {
      vscode.window.showErrorMessage(t('failed', msg));
    }
  }
}

async function execDeleteRemoteBranch(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName; // 예: origin/feature
  const slash = branchName.indexOf('/');
  if (slash < 0) return;
  const remote = branchName.substring(0, slash);
  const name = branchName.substring(slash + 1);

  // 원격은 실수 방지를 위해 두 번 확인
  const confirm1 = await vscode.window.showWarningMessage(
    t('confirmDeleteRemoteBranch', branchName),
    { modal: true, detail: t('deleteRemoteBranchDetail') },
    t('delete')
  );
  if (confirm1 !== t('delete')) return;

  const confirm2 = await vscode.window.showWarningMessage(
    t('confirmDeleteRemoteBranch2', branchName),
    { modal: true, detail: t('deleteRemoteBranchDetail2') },
    t('delete')
  );
  if (confirm2 !== t('delete')) return;

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification,
        title: t('executing', `git push ${remote} --delete ${name}`) },
      () => execGit(['push', remote, '--delete', name], cwd)
    );
    vscode.window.showInformationMessage(t('deleteBranchSuccess', branchName));
  } catch (err) {
    vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
  }
}

async function createBranch() {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = await vscode.window.showInputBox({
    prompt: t('enterBranchName'),
    placeHolder: t('enterBranchName'),
  });
  if (!branchName || !branchName.trim()) return;

  try {
    await execGit(['checkout', '-b', branchName.trim()], cwd);
    vscode.window.showInformationMessage(t('branchCreated', branchName.trim()));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function execSwitch(item) {
  const cwd = await validateGitWorkspace();
  if (!cwd) return;

  const branchName = item.branchName;
  const isRemote = item.contextValue === 'remoteBranch';
  const targetName = isRemote ? branchName.replace(/^[^/]+\//, '') : branchName;

  if (isRemote && item.unfetched) {
    try {
      await ensureRemoteBranchFetched(cwd, branchName);
      item.unfetched = false;
    } catch (err) {
      vscode.window.showErrorMessage(t('failed', (err.stderr || err.message || String(err)).trim()));
      return;
    }
  }

  // 원격 브랜치: 같은 이름의 로컬 브랜치가 이미 있으면 새로 만들지 않고 전환만 한다
  const createLocal = isRemote && !(await localBranchExists(cwd, targetName));

  const doSwitch = async (force) => {
    const args = ['switch'];
    if (force) args.push('--force');
    if (createLocal) {
      args.push('-c', targetName, branchName);
    } else {
      args.push(targetName);
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('executing', `git ${args.join(' ')}`) },
      () => execGit(args, cwd)
    );
    vscode.window.showInformationMessage(t('switchSuccess', targetName));
  };

  try {
    await doSwitch(false);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    if (!msg.includes('overwritten by checkout') && !msg.includes('would be overwritten')) {
      vscode.window.showErrorMessage(t('failed', msg.trim()));
      return;
    }
    const forceLabel = isKo ? '강제 전환 (변경사항 삭제)' : 'Force Switch (discard changes)';
    const choice = await vscode.window.showWarningMessage(
      isKo ? '커밋하지 않은 변경사항이 있어 브랜치를 전환할 수 없습니다. 변경사항을 커밋한 뒤 다시 시도하거나, 강제 전환하세요.'
            : 'Cannot switch branches: you have uncommitted changes. Commit your changes first, or force switch.',
      { modal: true },
      forceLabel
    );
    if (choice === forceLabel) {
      try {
        await doSwitch(true);
      } catch (forceErr) {
        const forceMsg = forceErr.stderr || forceErr.message || String(forceErr);
        vscode.window.showErrorMessage(t('failed', forceMsg.trim()));
      }
    }
  }
}

module.exports = {
  execDeleteBranch, execDeleteRemoteBranch, createBranch, execSwitch,
};
