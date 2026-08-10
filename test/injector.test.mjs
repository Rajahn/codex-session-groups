import assert from "node:assert/strict";
import test from "node:test";

import { isCodexTarget, parseArgs } from "../scripts/codex-injector.mjs";

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
});
