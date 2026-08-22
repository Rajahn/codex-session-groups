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
export const EXPECTED_UI_VERSION = "0.1.10";

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

export function isCodexTarget(target, expectedPort = null) {
  if (!target || target.type !== "page" || !target.webSocketDebuggerUrl) return false;
  let pageUrl;
  let socketUrl;
  try {
    pageUrl = new URL(String(target.url || ""));
    socketUrl = new URL(String(target.webSocketDebuggerUrl));
  } catch (_) {
    return false;
  }
  if (pageUrl.protocol !== "app:" || pageUrl.hostname !== "-" || pageUrl.pathname !== "/index.html") return false;
  const route = `${pageUrl.pathname}${pageUrl.search}`;
  if (["avatar-overlay", "global-dictation", "voice-mode"].some((marker) => route.includes(marker))) return false;
  if (socketUrl.hostname !== "127.0.0.1" || socketUrl.protocol !== "ws:") return false;
  if (expectedPort !== null && Number(socketUrl.port) !== expectedPort) return false;
  return true;
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

function launchCodex(appPath, port, waitForExit) {
  return spawn(
    "/usr/bin/open",
    [
      ...(waitForExit ? ["-W"] : []),
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
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { this.socket?.close(); } catch (_) {}
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("CDP connection timed out")), 5_000);
      this.socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        fail(new Error("CDP WebSocket connection failed"));
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
  try {
    await connection.open();
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
    const value = status.result?.value || { version: null, projectCount: 0 };
    if (value.version !== EXPECTED_UI_VERSION) {
      throw new Error(`UI version verification failed: expected ${EXPECTED_UI_VERSION}, got ${value.version || "null"}`);
    }
    return value;
  } finally {
    connection.close();
  }
}

export async function runInjectionCycle(targets, injected, inject, sources) {
  const liveIds = new Set(targets.map((target) => target.id));
  for (const id of injected) {
    if (!liveIds.has(id)) injected.delete(id);
  }

  const successes = [];
  const failures = [];
  for (const target of targets) {
    if (injected.has(target.id)) continue;
    try {
      const status = await inject(target, sources);
      if (status?.version !== EXPECTED_UI_VERSION) {
        throw new Error(`UI version verification failed: expected ${EXPECTED_UI_VERSION}, got ${status?.version || "null"}`);
      }
      injected.add(target.id);
      successes.push({ target, status });
    } catch (error) {
      failures.push({ target, error });
    }
  }
  return { successes, failures };
}

export function childProcessFinished(child) {
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null));
}

export async function waitForNextPoll(delayMs, child = null) {
  if (childProcessFinished(child)) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.removeListener?.("exit", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    child?.once?.("exit", finish);
  });
}

export async function runInjectionLoop({
  watch,
  pollMs,
  port,
  sources,
  launchedProcess = null,
  fetchTargetsFn = fetchTargets,
  injectTargetFn = injectTarget,
  sleepFn = waitForNextPoll,
  isStopping = () => false,
  now = Date.now,
  onceTimeoutMs = 15_000,
  logger = console,
}) {
  const injected = new Set();
  const reportedTargetErrors = new Map();
  let reportedFetchError = "";
  const onceDeadline = now() + onceTimeoutMs;

  while (!isStopping()) {
    if (childProcessFinished(launchedProcess)) break;
    let targets;
    try {
      targets = (await fetchTargetsFn(port)).filter((target) => isCodexTarget(target, port));
      if (reportedFetchError) {
        logger.log("Codex debugger connection recovered");
        reportedFetchError = "";
      }
    } catch (error) {
      if (childProcessFinished(launchedProcess)) break;
      if (launchedProcess) {
        await sleepFn(Math.min(pollMs, 250), launchedProcess);
        if (childProcessFinished(launchedProcess)) break;
      }
      if (!watch && now() >= onceDeadline) {
        throw new Error(`Timed out waiting for a usable Codex renderer: ${error.message}`);
      }
      if (reportedFetchError !== error.message) {
        logger.warn(`Codex debugger temporarily unavailable: ${error.message}`);
        reportedFetchError = error.message;
      }
      await sleepFn(watch ? pollMs : Math.min(pollMs, 500), launchedProcess);
      continue;
    }

    const cycle = await runInjectionCycle(targets, injected, injectTargetFn, sources);
    for (const { target, status } of cycle.successes) {
      reportedTargetErrors.delete(target.id);
      logger.log(`Injected session groups ${status.version} into Codex (${status.projectCount} projects visible)`);
    }
    for (const { target, error } of cycle.failures) {
      if (reportedTargetErrors.get(target.id) === error.message) continue;
      reportedTargetErrors.set(target.id, error.message);
      logger.warn(`Session groups injection will retry for ${target.id}: ${error.message}`);
    }

    if (!watch) {
      const allTargetsInjected = targets.length > 0 && targets.every((target) => injected.has(target.id));
      if (allTargetsInjected) return { injected };
      if (now() >= onceDeadline) {
        const detail = cycle.failures.at(-1)?.error?.message || "no eligible Codex renderer target appeared";
        throw new Error(`Timed out waiting for a usable Codex renderer: ${detail}`);
      }
      await sleepFn(Math.min(pollMs, 500), launchedProcess);
      continue;
    }

    await sleepFn(pollMs, launchedProcess);
  }
  return { injected };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  let launchedProcess = null;
  const port = options.port || await chooseLoopbackPort();
  const sources = {
    model: await readFile(modelPath, "utf8"),
    ui: await readFile(uiPath, "utf8"),
  };
  if (options.launch) {
    if (codexIsRunning()) {
      throw new Error("Codex is already running. Quit it first, then run npm start again. Existing tasks are not affected.");
    }
    console.log(`Starting Codex with local session groups (debugger: 127.0.0.1:${port})`);
    const launchHelper = launchCodex(options.appPath, port, options.watch);
    launchHelper.unref();
    if (options.watch) launchedProcess = launchHelper;
  }

  await waitForDebugger(port);
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  await runInjectionLoop({
    watch: options.watch,
    pollMs: options.pollMs,
    port,
    sources,
    launchedProcess,
    isStopping: () => stopping,
  });
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`codex-session-groups: ${error.message}`);
    process.exitCode = 1;
  });
}
