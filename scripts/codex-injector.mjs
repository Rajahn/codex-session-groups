#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const modelPath = path.join(projectRoot, "inject", "model.js");
const uiPath = path.join(projectRoot, "inject", "session-groups.user.js");

export function parseArgs(argv) {
  const options = {
    launch: false,
    attach: false,
    watch: false,
    port: null,
    appPath: "/Applications/ChatGPT.app",
    pollMs: 1_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--launch") options.launch = true;
    else if (arg === "--attach") options.attach = true;
    else if (arg === "--watch") options.watch = true;
    else if (arg === "--once") options.watch = false;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--app-path") options.appPath = path.resolve(argv[++index] || "");
    else if (arg === "--poll-ms") options.pollMs = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (options.launch === options.attach && !options.help) {
    throw new Error("Choose exactly one of --launch or --attach");
  }
  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  if (options.attach && options.port === null) throw new Error("--attach requires --port");
  if (!Number.isInteger(options.pollMs) || options.pollMs < 250 || options.pollMs > 30_000) {
    throw new Error("--poll-ms must be between 250 and 30000");
  }
  return options;
}

export function isCodexTarget(target) {
  if (!target || target.type !== "page" || !target.webSocketDebuggerUrl) return false;
  if (!String(target.url || "").startsWith("app://")) return false;
  const url = String(target.url || "");
  return !url.includes("avatar-overlay")
    && !url.includes("global-dictation")
    && !url.includes("voice-mode");
}

function helpText() {
  return `Codex Session Groups

Usage:
  node scripts/codex-injector.mjs --launch [--watch] [--port 45000]
  node scripts/codex-injector.mjs --attach --port 45000 [--watch]

Options:
  --launch          Start Codex with loopback-only remote debugging
  --attach          Attach to an already-debuggable Codex instance
  --watch           Keep watching for new Codex renderer pages
  --once            Inject current pages and exit
  --port NUMBER     Debugging port (random local port by default for --launch)
  --app-path PATH   Codex/ChatGPT app path
  --poll-ms NUMBER  Watch interval, default 1000
`;
}

function codexIsRunning() {
  return spawnSync("/usr/bin/pgrep", ["-x", "ChatGPT"], { stdio: "ignore" }).status === 0;
}

async function chooseLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not reserve a loopback debugging port");
  return port;
}

function launchCodex(appPath, port) {
  return spawn(
    "/usr/bin/open",
    [
      "-W",
      "-a",
      appPath,
      "--args",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--remote-allow-origins=http://127.0.0.1:${port}`,
    ],
    { stdio: "ignore" },
  );
}

async function fetchTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function waitForDebugger(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetchTargets(port);
      return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for Codex debugging on 127.0.0.1:${port}`);
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timed out")), 5_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket connection failed"));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      const error = new Error("CDP connection closed");
      this.pending.forEach((pending) => pending.reject(error));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 8_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function assertEvaluation(result, label) {
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Unknown evaluation error";
    throw new Error(`${label}: ${detail}`);
  }
}

async function injectTarget(target, sources) {
  const connection = new CdpConnection(target.webSocketDebuggerUrl);
  await connection.open();
  try {
    await connection.send("Page.enable");
    await connection.send("Runtime.enable");
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: sources.model });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: sources.ui });
    await connection.send("Runtime.evaluate", {
      expression: "try { globalThis.__CODEX_SESSION_GROUPS_V1__?.destroy?.(); } catch (_) {}",
    });
    await connection.send("Runtime.evaluate", {
      expression: "try { delete globalThis.__CODEX_SESSION_GROUPS_MODEL_V1__; } catch (_) {}",
    });
    const modelResult = await connection.send("Runtime.evaluate", {
      expression: sources.model,
      awaitPromise: true,
    });
    assertEvaluation(modelResult, "Model injection failed");
    const uiResult = await connection.send("Runtime.evaluate", {
      expression: sources.ui,
      awaitPromise: true,
    });
    assertEvaluation(uiResult, "UI injection failed");
    const status = await connection.send("Runtime.evaluate", {
      expression: "({ version: globalThis.__CODEX_SESSION_GROUPS_V1__?.version || null, projectCount: document.querySelectorAll('[data-app-action-sidebar-project-row]').length })",
      returnByValue: true,
    });
    return status.result?.value || { version: null, projectCount: 0 };
  } finally {
    connection.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  let launchedProcess = null;
  const port = options.port || await chooseLoopbackPort();
  if (options.launch) {
    if (codexIsRunning()) {
      throw new Error("Codex is already running. Quit it first, then run npm start again. Existing tasks are not affected.");
    }
    console.log(`Starting Codex with local session groups (debugger: 127.0.0.1:${port})`);
    launchedProcess = launchCodex(options.appPath, port);
  }

  await waitForDebugger(port);
  const sources = {
    model: await readFile(modelPath, "utf8"),
    ui: await readFile(uiPath, "utf8"),
  };
  const injected = new Set();
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  do {
    const targets = (await fetchTargets(port)).filter(isCodexTarget);
    const liveIds = new Set(targets.map((target) => target.id));
    for (const id of injected) {
      if (!liveIds.has(id)) injected.delete(id);
    }
    for (const target of targets) {
      if (injected.has(target.id)) continue;
      const status = await injectTarget(target, sources);
      injected.add(target.id);
      console.log(`Injected session groups ${status.version || "unknown"} into Codex (${status.projectCount} projects visible)`);
    }
    if (!options.watch) break;
    if (launchedProcess && launchedProcess.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  } while (!stopping);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`codex-session-groups: ${error.message}`);
    process.exitCode = 1;
  });
}
