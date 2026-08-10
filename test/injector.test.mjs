import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  EXPECTED_UI_VERSION,
  childProcessFinished,
  isCodexTarget,
  parseArgs,
  runInjectionCycle,
  runInjectionLoop,
  waitForNextPoll,
} from "../scripts/codex-injector.mjs";

const validTarget = (id = "page-1", port = 9337) => ({
  id,
  type: "page",
  url: "app://-/index.html",
  webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`,
});

test("parses launch and attach modes", () => {
  assert.deepEqual(parseArgs(["--launch", "--watch", "--port", "45000"]), {
    launch: true,
    attach: false,
    watch: true,
    port: 45000,
    appPath: "/Applications/ChatGPT.app",
    pollMs: 1_000,
  });
  assert.equal(parseArgs(["--attach", "--port", "9337"]).attach, true);
  assert.throws(() => parseArgs(["--attach"]), /requires --port/);
  assert.throws(() => parseArgs(["--launch", "--attach"]), /exactly one/);
});
test("only selects the main Codex renderer", () => {
  const base = { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1/page" };
  assert.equal(isCodexTarget({ ...base, url: "app://-/index.html" }), true);
  assert.equal(isCodexTarget({ ...base, url: "app://-/index.html?initialRoute=%2Favatar-overlay" }), false);
  assert.equal(isCodexTarget({ ...base, url: "https://example.com" }), false);
  assert.equal(isCodexTarget({ ...base, type: "worker", url: "app://-/index.html" }), false);
  assert.equal(isCodexTarget({ ...base, url: "app://unrelated/index.html" }), false);
  assert.equal(isCodexTarget({ ...base, url: "app://-/settings.html" }), false);
  assert.equal(isCodexTarget({ ...base, webSocketDebuggerUrl: "ws://evil.example/page", url: "app://-/index.html" }), false);
  assert.equal(isCodexTarget({ ...base, webSocketDebuggerUrl: "ws://localhost:9337/page", url: "app://-/index.html" }, 9337), false);
  assert.equal(isCodexTarget({ ...base, webSocketDebuggerUrl: "wss://127.0.0.1:9337/page", url: "app://-/index.html" }, 9337), false);
  assert.equal(isCodexTarget({ ...base, webSocketDebuggerUrl: "ws://127.0.0.1:9337/page", url: "app://-/index.html" }, 9338), false);
  assert.equal(isCodexTarget({ ...base, webSocketDebuggerUrl: "ws://127.0.0.1:9337/page", url: "app://-/index.html" }, 9337), true);
});

test("only records targets after the expected UI version is verified", async () => {
  const target = { id: "page-1" };
  const injected = new Set();
  const first = await runInjectionCycle([target], injected, async () => ({
    version: null,
    projectCount: 0,
  }), {});
  assert.equal(first.failures.length, 1);
  assert.equal(injected.has(target.id), false);

  const second = await runInjectionCycle([target], injected, async () => ({
    version: EXPECTED_UI_VERSION,
    projectCount: 1,
  }), {});
  assert.equal(second.successes.length, 1);
  assert.equal(injected.has(target.id), true);
});

test("a failed target does not block another target or its own retry", async () => {
  const failing = { id: "page-failing" };
  const healthy = { id: "page-healthy" };
  const injected = new Set();
  let failingAttempts = 0;
  const inject = async (target) => {
    if (target.id === failing.id && failingAttempts++ === 0) throw new Error("renderer changed");
    return { version: EXPECTED_UI_VERSION, projectCount: 2 };
  };

  const first = await runInjectionCycle([failing, healthy], injected, inject, {});
  assert.deepEqual(first.successes.map(({ target }) => target.id), [healthy.id]);
  assert.deepEqual(first.failures.map(({ target }) => target.id), [failing.id]);
  assert.deepEqual([...injected], [healthy.id]);

  const second = await runInjectionCycle([failing, healthy], injected, inject, {});
  assert.deepEqual(second.successes.map(({ target }) => target.id), [failing.id]);
  assert.equal(second.failures.length, 0);
  assert.deepEqual(new Set(injected), new Set([healthy.id, failing.id]));
});

test("drops closed renderer ids so a reused page can be injected", async () => {
  const injected = new Set(["stale-page"]);
  const target = { id: "new-page" };
  const result = await runInjectionCycle([target], injected, async () => ({
    version: EXPECTED_UI_VERSION,
    projectCount: 0,
  }), {});
  assert.equal(result.failures.length, 0);
  assert.deepEqual([...injected], ["new-page"]);
});

test("watch mode recovers from a transient debugger fetch failure", async () => {
  let fetches = 0;
  let stop = false;
  const logs = [];
  const result = await runInjectionLoop({
    watch: true,
    pollMs: 250,
    port: 9337,
    sources: {},
    fetchTargetsFn: async () => {
      fetches += 1;
      if (fetches === 1) throw new Error("temporary fetch failure");
      return [validTarget()];
    },
    injectTargetFn: async () => {
      stop = true;
      return { version: EXPECTED_UI_VERSION, projectCount: 1 };
    },
    sleepFn: async () => {},
    isStopping: () => stop,
    logger: { log: (message) => logs.push(message), warn: (message) => logs.push(message) },
  });
  assert.equal(fetches, 2);
  assert.equal(result.injected.has("page-1"), true);
  assert.ok(logs.some((message) => message.includes("temporarily unavailable")));
  assert.ok(logs.some((message) => message.includes("connection recovered")));
});

test("once mode fails when no eligible renderer appears before the deadline", async () => {
  let clock = 0;
  await assert.rejects(() => runInjectionLoop({
    watch: false,
    pollMs: 500,
    port: 9337,
    sources: {},
    fetchTargetsFn: async () => [],
    injectTargetFn: async () => ({ version: EXPECTED_UI_VERSION, projectCount: 0 }),
    sleepFn: async (ms) => { clock += ms; },
    now: () => clock,
    onceTimeoutMs: 1_000,
    logger: { log() {}, warn() {} },
  }), /no eligible Codex renderer target appeared/);
});

test("once mode retries a failed renderer and requires all live targets", async () => {
  let attempts = 0;
  const result = await runInjectionLoop({
    watch: false,
    pollMs: 250,
    port: 9337,
    sources: {},
    fetchTargetsFn: async () => [validTarget()],
    injectTargetFn: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("navigation changed");
      return { version: EXPECTED_UI_VERSION, projectCount: 1 };
    },
    sleepFn: async () => {},
    logger: { log() {}, warn() {} },
  });
  assert.equal(attempts, 2);
  assert.equal(result.injected.has("page-1"), true);
});

test("child completion includes signals and wakes polling promptly", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  assert.equal(childProcessFinished(child), false);
  const started = Date.now();
  setTimeout(() => {
    child.signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");
  }, 20);
  await waitForNextPoll(1_000, child);
  assert.equal(childProcessFinished(child), true);
  assert.ok(Date.now() - started < 300);
});

test("normal launched-app exit suppresses a transport warning", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const warnings = [];
  await runInjectionLoop({
    watch: true,
    pollMs: 1_000,
    port: 9337,
    sources: {},
    launchedProcess: child,
    fetchTargetsFn: async () => {
      setTimeout(() => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      }, 20);
      throw new Error("fetch failed during shutdown");
    },
    injectTargetFn: async () => ({ version: EXPECTED_UI_VERSION, projectCount: 0 }),
    logger: { log() {}, warn: (message) => warnings.push(message) },
  });
  assert.deepEqual(warnings, []);
});
