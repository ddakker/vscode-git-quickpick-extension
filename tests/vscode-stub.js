'use strict';

// ─────────────────────────────────────────────────────────────────────
// 'vscode' 모듈 스텁
// extension.js는 require('vscode')를 호출하는데, 이는 VS Code 런타임에서만
// 제공되는 모듈이다. 테스트에서는 pure 함수만 검증하므로 최소한의 API 표면을
// 제공하는 스텁으로 교체한다. 이 파일을 첫 번째로 require하면 Module 캐시에
// 가짜 'vscode' 모듈이 등록되어 이후 extension.js를 require할 수 있다.
// ─────────────────────────────────────────────────────────────────────

const Module = require('module');

const noop = () => {};
const noopDisposable = { dispose: noop };
const noopEvent = () => noopDisposable;

const stub = {
  env: { language: 'en', clipboard: { writeText: () => Promise.resolve() } },
  window: {
    createOutputChannel: () => ({
      appendLine: noop, append: noop, show: noop, hide: noop,
      clear: noop, dispose: noop, replace: noop,
    }),
    showErrorMessage: () => Promise.resolve(),
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showInputBox: () => Promise.resolve(''),
    showQuickPick: () => Promise.resolve(undefined),
    showOpenDialog: () => Promise.resolve(undefined),
    createTerminal: () => ({ show: noop, sendText: noop, dispose: noop }),
    registerWebviewViewProvider: () => noopDisposable,
    createTreeView: () => ({
      dispose: noop,
      onDidChangeVisibility: noopEvent,
      onDidExpandElement: noopEvent,
      onDidCollapseElement: noopEvent,
      onDidChangeCheckboxState: noopEvent,
      onDidChangeSelection: noopEvent,
      reveal: () => Promise.resolve(),
      visible: false,
      selection: [],
    }),
    onDidChangeTextEditorSelection: noopEvent,
    onDidChangeActiveTextEditor: noopEvent,
    onDidChangeTextEditorVisibleRanges: noopEvent,
    activeTextEditor: null,
    visibleTextEditors: [],
    createStatusBarItem: () => ({
      show: noop, hide: noop, dispose: noop,
      text: '', tooltip: '', command: '',
    }),
    createTextEditorDecorationType: () => ({ dispose: noop, key: 'stub' }),
    withProgress: (_opts, task) => task({ report: noop }),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: () => null,
      update: () => Promise.resolve(),
      has: () => false,
      inspect: () => undefined,
    }),
    registerTextDocumentContentProvider: () => noopDisposable,
    createFileSystemWatcher: () => ({
      onDidCreate: noopEvent,
      onDidChange: noopEvent,
      onDidDelete: noopEvent,
      dispose: noop,
    }),
    onDidSaveTextDocument: noopEvent,
    onDidChangeConfiguration: noopEvent,
    onDidChangeTextDocument: noopEvent,
    getWorkspaceFolder: () => null,
    asRelativePath: (p) => p,
    openTextDocument: () => Promise.resolve({}),
    applyEdit: () => Promise.resolve(true),
    fs: {
      readFile: () => Promise.resolve(Buffer.alloc(0)),
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({}),
    },
  },
  commands: {
    registerCommand: () => noopDisposable,
    executeCommand: () => Promise.resolve(),
    getCommands: () => Promise.resolve([]),
  },
  extensions: {
    getExtension: () => null,
    all: [],
  },
  languages: {
    registerHoverProvider: () => noopDisposable,
    registerCompletionItemProvider: () => noopDisposable,
  },
  Uri: {
    file: (p) => ({
      fsPath: p, scheme: 'file', path: p,
      toString: () => `file://${p}`,
      with: (change) => ({ ...this, ...change }),
    }),
    parse: (s) => ({
      fsPath: s, scheme: (s.split(':')[0] || 'file'), path: s,
      toString: () => s,
    }),
    joinPath: (base, ...parts) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
      path: [base.path, ...parts].join('/'),
      scheme: base.scheme,
      toString: () => [base.toString(), ...parts].join('/'),
    }),
  },
  EventEmitter: class {
    constructor() { this.event = noopEvent; }
    fire() {}
    dispose() {}
  },
  TreeItem: class {
    constructor(label, state) {
      this.label = label;
      this.collapsibleState = state;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  Range: class {
    constructor(a, b, c, d) {
      if (typeof a === 'object') { this.start = a; this.end = b; }
      else { this.start = { line: a, character: b }; this.end = { line: c, character: d }; }
    }
  },
  Position: class {
    constructor(line, character) { this.line = line; this.character = character; }
  },
  Selection: class {
    constructor(a, b, c, d) {
      this.anchor = { line: a, character: b };
      this.active = { line: c, character: d };
      this.start = this.anchor;
      this.end = this.active;
    }
  },
  MarkdownString: class {
    constructor(s) { this.value = s || ''; this.isTrusted = false; this.supportThemeIcons = false; }
    appendMarkdown(s) { this.value += s; return this; }
    appendText(s) { this.value += s; return this; }
    appendCodeblock(s, lang) { this.value += `\n\`\`\`${lang || ''}\n${s}\n\`\`\``; return this; }
  },
  FileDecoration: class {
    constructor(badge, tooltip, color) {
      this.badge = badge; this.tooltip = tooltip; this.color = color;
    }
  },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64, Unknown: 0 },
  Disposable: class {
    static from(...items) { return { dispose: () => items.forEach(i => i?.dispose?.()) }; }
    dispose() {}
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  EndOfLine: { LF: 1, CRLF: 2 },
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
};

// Module._resolveFilename 인터셉트로 'vscode' 요청을 가짜 경로로 전환
const FAKE_PATH = 'vscode-stub-fake-path';
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  if (request === 'vscode') return FAKE_PATH;
  return origResolve.call(this, request, ...args);
};

// require.cache에 fake 엔트리 등록
require.cache[FAKE_PATH] = {
  id: FAKE_PATH,
  filename: FAKE_PATH,
  loaded: true,
  exports: stub,
  children: [],
  paths: [],
};

module.exports = stub;
