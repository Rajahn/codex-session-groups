import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../inject/model.js", import.meta.url), "utf8");
const context = vm.createContext({
  Date,
  Math,
  Object,
  Set,
  String,
  globalThis: {},
});
vm.runInContext(source, context);
const model = context.globalThis.__CODEX_SESSION_GROUPS_MODEL_V1__;

test("replaces an older injected model implementation", () => {
  const staleContext = vm.createContext({
    Date,
    Math,
    Object,
    Set,
    String,
    globalThis: {
      __CODEX_SESSION_GROUPS_MODEL_V1__: Object.freeze({ VERSION: 1 }),
    },
  });
  vm.runInContext(source, staleContext);
  assert.equal(staleContext.globalThis.__CODEX_SESSION_GROUPS_MODEL_V1__.IMPLEMENTATION_VERSION, "0.1.3");
  assert.equal(typeof staleContext.globalThis.__CODEX_SESSION_GROUPS_MODEL_V1__.unassignThreads, "function");
});

test("normalizes malformed state without retaining invalid memberships", () => {
  assert.equal(model.IMPLEMENTATION_VERSION, "0.1.3");
  const state = model.normalizeState({
    projects: {
      project: {
        groups: [
          { id: "group-a", name: " A  group ", collapsed: 1 },
          { id: "group-a", name: "duplicate" },
          { id: "", name: "invalid" },
        ],
        membership: { taskA: "group-a", taskB: "missing" },
        threadHints: {
          taskA: { title: "Task A", hostId: "local", kind: "local" },
          taskB: { title: "orphan" },
          taskC: { title: "not assigned" },
        },
      },
    },
  });

  assert.equal(state.version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(state.projects.project.groups)), [
    { id: "group-a", name: "A group", collapsed: true, createdAt: 0, updatedAt: 0 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(state.projects.project.membership)), { taskA: "group-a" });
  assert.deepEqual(JSON.parse(JSON.stringify(state.projects.project.threadHints)), {
    taskA: { title: "Task A", hostId: "local", kind: "local" },
  });
});

test("creates unique names and supports rename, collapse, and membership", () => {
  let state = model.emptyState();
  const first = model.createGroup(state, "project", "长期任务", "group-a");
  state = first.state;
  const second = model.createGroup(state, "project", "长期任务", "group-b");
  state = second.state;

  assert.equal(first.group.name, "长期任务");
  assert.equal(second.group.name, "长期任务 2");

  state = model.renameGroup(state, "project", "group-b", "长期任务").state;
  assert.equal(state.projects.project.groups[1].name, "长期任务 2");

  state = model.assignThread(state, "project", "local:thread-1", "group-a", {
    title: "Thread 1",
    hostId: "local",
    kind: "local",
  }).state;
  assert.equal(state.projects.project.membership["local:thread-1"], "group-a");
  assert.equal(state.projects.project.threadHints["local:thread-1"].title, "Thread 1");

  state = model.setCollapsed(state, "project", "group-a", true).state;
  assert.equal(state.projects.project.groups[0].collapsed, true);

  state = model.assignThread(state, "project", "local:thread-1", null).state;
  assert.equal(state.projects.project.membership["local:thread-1"], undefined);
  assert.equal(state.projects.project.threadHints["local:thread-1"], undefined);
});

test("deleting a group only removes visual membership", () => {
  let state = model.createGroup(model.emptyState(), "project", "Long task", "group-a").state;
  state = model.assignThread(state, "project", "local:thread-1", "group-a").state;
  const result = model.deleteGroup(state, "project", "group-a");

  assert.equal(result.group.name, "Long task");
  assert.equal(result.state.projects.project, undefined);
});

test("unassigns archived threads without changing groups or other memberships", () => {
  let state = model.createGroup(model.emptyState(), "project", "Long task", "group-a").state;
  state = model.assignThread(state, "project", "local:archived", "group-a").state;
  state = model.assignThread(state, "project", "local:remaining", "group-a").state;

  const result = model.unassignThreads(state, "project", ["local:archived", "local:unknown"]);

  assert.deepEqual(JSON.parse(JSON.stringify(result.threadIds)), ["local:archived"]);
  assert.equal(result.state.projects.project.groups[0].name, "Long task");
  assert.deepEqual(JSON.parse(JSON.stringify(result.state.projects.project.membership)), {
    "local:remaining": "group-a",
  });
});

test("migrates a uniquely matched temporary thread id after restart", () => {
  let state = model.createGroup(model.emptyState(), "project", "Long task", "group-a").state;
  state = model.assignThread(state, "project", "local:client-new-thread:temp-1", "group-a", {
    title: "分析商责单延迟写入原因",
    hostId: "local",
    kind: "local",
  }).state;

  const result = model.syncThreadIdentities(state, "project", [{
    id: "local:stable-1",
    title: "分析商责单延迟写入原因",
    hostId: "local",
    kind: "local",
  }], true);

  assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.migrations)), [{
    fromThreadId: "local:client-new-thread:temp-1",
    toThreadId: "local:stable-1",
    groupId: "group-a",
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.state.projects.project.membership)), {
    "local:stable-1": "group-a",
  });
  assert.equal(result.state.projects.project.threadHints["local:stable-1"].title, "分析商责单延迟写入原因");
});

test("does not guess a new id when the title match is ambiguous or the list is partial", () => {
  let state = model.createGroup(model.emptyState(), "project", "Long task", "group-a").state;
  state = model.assignThread(state, "project", "local:client-new-thread:temp-1", "group-a", {
    title: "重复标题",
    hostId: "local",
    kind: "local",
  }).state;
  const candidates = [
    { id: "local:stable-1", title: "重复标题", hostId: "local", kind: "local" },
    { id: "local:stable-2", title: "重复标题", hostId: "local", kind: "local" },
  ];

  const ambiguous = model.syncThreadIdentities(state, "project", candidates, true);
  assert.equal(ambiguous.changed, false);
  assert.equal(ambiguous.state.projects.project.membership["local:client-new-thread:temp-1"], "group-a");

  const partial = model.syncThreadIdentities(state, "project", [candidates[0]], false);
  assert.equal(partial.changed, false);
  assert.equal(partial.state.projects.project.membership["local:client-new-thread:temp-1"], "group-a");
});

test("does not migrate legacy temporary ids without a saved fingerprint", () => {
  let state = model.createGroup(model.emptyState(), "project", "Long task", "group-a").state;
  state = model.assignThread(state, "project", "local:client-new-thread:legacy", "group-a").state;
  const result = model.syncThreadIdentities(state, "project", [{
    id: "local:stable-1",
    title: "Possibly the same task",
    hostId: "local",
    kind: "local",
  }], true);

  assert.equal(result.changed, false);
  assert.equal(result.state.projects.project.membership["local:client-new-thread:legacy"], "group-a");
});

test("counts already-grouped matching targets as ambiguity blockers", () => {
  let state = model.createGroup(model.emptyState(), "project", "A", "group-a").state;
  state = model.createGroup(state, "project", "B", "group-b").state;
  const hint = { title: "重复标题", hostId: "local", kind: "local" };
  state = model.assignThread(state, "project", "local:client-new-thread:temp", "group-a", hint).state;
  state = model.assignThread(state, "project", "local:stable-grouped", "group-b", hint).state;

  const result = model.syncThreadIdentities(state, "project", [
    { id: "local:stable-grouped", ...hint },
    { id: "local:stable-free", ...hint },
  ], true);

  assert.deepEqual(JSON.parse(JSON.stringify(result.migrations)), []);
  assert.equal(result.state.projects.project.membership["local:client-new-thread:temp"], "group-a");
  assert.equal(result.state.projects.project.membership["local:stable-grouped"], "group-b");
  assert.equal(result.state.projects.project.membership["local:stable-free"], undefined);
});

test("does not migrate overlapping weak and strong source fingerprints", () => {
  let state = model.createGroup(model.emptyState(), "project", "A", "group-a").state;
  state = model.createGroup(state, "project", "B", "group-b").state;
  state = model.assignThread(state, "project", "local:client-new-thread:weak", "group-a", {
    title: "重复标题",
  }).state;
  state = model.assignThread(state, "project", "local:client-new-thread:strong", "group-b", {
    title: "重复标题",
    hostId: "local",
    kind: "local",
  }).state;

  const result = model.syncThreadIdentities(state, "project", [{
    id: "local:stable",
    title: "重复标题",
    hostId: "local",
    kind: "local",
  }], true);

  assert.deepEqual(JSON.parse(JSON.stringify(result.migrations)), []);
  assert.equal(result.state.projects.project.membership["local:client-new-thread:weak"], "group-a");
  assert.equal(result.state.projects.project.membership["local:client-new-thread:strong"], "group-b");
  assert.equal(result.state.projects.project.membership["local:stable"], undefined);
});

test("uses external matching rows only to block migration", () => {
  let state = model.createGroup(model.emptyState(), "project", "A", "group-a").state;
  const hint = { title: "同名任务", hostId: "local", kind: "local" };
  state = model.assignThread(state, "project", "local:client-new-thread:temp", "group-a", hint).state;

  const blockedByPinned = model.syncThreadIdentities(state, "project", [
    { id: "local:stable-own", ...hint, migrationTarget: true },
    { id: "local:stable-pinned", ...hint, migrationTarget: false },
  ], true);
  assert.deepEqual(JSON.parse(JSON.stringify(blockedByPinned.migrations)), []);
  assert.equal(blockedByPinned.state.projects.project.membership["local:client-new-thread:temp"], "group-a");

  const externalOnly = model.syncThreadIdentities(state, "project", [
    { id: "local:stable-pinned", ...hint, migrationTarget: false },
  ], true);
  assert.deepEqual(JSON.parse(JSON.stringify(externalOnly.migrations)), []);
  assert.equal(externalOnly.state.projects.project.membership["local:client-new-thread:temp"], "group-a");
});

test("duplicate descriptor ids fail closed independent of DOM order", () => {
  let state = model.createGroup(model.emptyState(), "project", "A", "group-a").state;
  const sourceHint = { title: "A", hostId: "local", kind: "local" };
  state = model.assignThread(state, "project", "local:client-new-thread:temp", "group-a", sourceHint).state;
  const matching = { id: "local:stable", ...sourceHint, migrationTarget: true };
  const conflicting = {
    id: "local:stable",
    title: "B",
    hostId: "local",
    kind: "local",
    migrationTarget: false,
  };

  for (const descriptors of [[matching, conflicting], [conflicting, matching]]) {
    const result = model.syncThreadIdentities(state, "project", descriptors, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.migrations)), []);
    assert.equal(result.state.projects.project.membership["local:client-new-thread:temp"], "group-a");
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.state.projects.project.threadHints["local:client-new-thread:temp"])),
      sourceHint,
    );
  }
});

test("duplicate descriptor ids with mixed eligibility cannot become a target", () => {
  let state = model.createGroup(model.emptyState(), "project", "A", "group-a").state;
  const hint = { title: "A", hostId: "local", kind: "local" };
  state = model.assignThread(state, "project", "local:client-new-thread:temp", "group-a", hint).state;
  const eligible = { id: "local:stable", ...hint, migrationTarget: true };
  const external = { id: "local:stable", ...hint, migrationTarget: false };

  for (const descriptors of [[eligible, external], [external, eligible]]) {
    const result = model.syncThreadIdentities(state, "project", descriptors, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.migrations)), []);
    assert.equal(result.state.projects.project.membership["local:client-new-thread:temp"], "group-a");
  }
});

test("conflicting duplicate rows do not rewrite an existing saved hint", () => {
  let state = model.createGroup(model.emptyState(), "project", "A", "group-a").state;
  const saved = { title: "Saved", hostId: "local", kind: "local" };
  state = model.assignThread(state, "project", "local:stable", "group-a", saved).state;
  const result = model.syncThreadIdentities(state, "project", [
    { id: "local:stable", title: "First", hostId: "local", kind: "local" },
    { id: "local:stable", title: "Second", hostId: "local", kind: "local" },
  ], true);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result.state.projects.project.threadHints["local:stable"])),
    saved,
  );
});

test("supports reserved object keys without prototype collisions", () => {
  let state = model.createGroup(model.emptyState(), "__proto__", "Reserved", "constructor").state;
  state = model.assignThread(state, "__proto__", "__proto__", "constructor", {
    title: "Reserved task",
    hostId: "local",
    kind: "local",
  }).state;

  assert.equal(Object.hasOwn(state.projects, "__proto__"), true);
  assert.equal(Object.hasOwn(state.projects.__proto__.membership, "__proto__"), true);
  assert.equal(state.projects.__proto__.membership.__proto__, "constructor");

  const roundTripped = model.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(Object.hasOwn(roundTripped.projects, "__proto__"), true);
  assert.equal(roundTripped.projects.__proto__.membership.__proto__, "constructor");
  const unassigned = model.unassignThreads(roundTripped, "__proto__", ["__proto__"]);
  assert.equal(Object.hasOwn(unassigned.state.projects.__proto__.membership, "__proto__"), false);
});
