import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const modelSource = await readFile(new URL("../inject/model.js", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../inject/session-groups.user.js", import.meta.url), "utf8");
const projectId = "project";
const groupId = "group-a";

const delay = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

function descriptor(id, title = id) {
  return { id, title, hostId: "local", kind: "local" };
}

function makeThreadWrapper(window, thread, { archiveButton = false, pinned = false } = {}) {
  const wrapper = window.document.createElement("div");
  wrapper.setAttribute("role", "listitem");
  const row = window.document.createElement("div");
  row.setAttribute("role", "button");
  row.setAttribute("data-app-action-sidebar-thread-id", thread.id);
  row.setAttribute("data-app-action-sidebar-thread-title", thread.title);
  row.setAttribute("data-app-action-sidebar-thread-host-id", thread.hostId);
  row.setAttribute("data-app-action-sidebar-thread-kind", thread.kind);
  row.setAttribute("data-app-action-sidebar-thread-pinned", String(pinned));
  row.setAttribute("aria-label", thread.title);
  const title = window.document.createElement("span");
  title.textContent = thread.title;
  row.appendChild(title);
  if (archiveButton) {
    const button = window.document.createElement("button");
    button.setAttribute("aria-label", "归档聊天");
    row.appendChild(button);
  }
  wrapper.appendChild(row);
  return wrapper;
}

function makeProjectList(window, threads, { showAll = "true", onShowAll = null } = {}) {
  const list = window.document.createElement("div");
  list.setAttribute("data-app-action-sidebar-project-list-id", projectId);
  list.setAttribute("data-app-action-sidebar-project-show-all", showAll);
  const stack = window.document.createElement("div");
  stack.setAttribute("role", "list");
  threads.forEach((thread) => stack.appendChild(makeThreadWrapper(window, thread)));
  if (showAll === "false") {
    const controlItem = window.document.createElement("div");
    controlItem.setAttribute("role", "listitem");
    const control = window.document.createElement("button");
    control.textContent = "展开显示";
    if (onShowAll) control.addEventListener("click", () => onShowAll({ list, stack, controlItem }));
    controlItem.appendChild(control);
    stack.appendChild(controlItem);
  }
  list.appendChild(stack);
  return { list, stack };
}

function savedState(memberHints, { collapsed = false } = {}) {
  const membership = {};
  const threadHints = {};
  memberHints.forEach((thread) => {
    membership[thread.id] = groupId;
    threadHints[thread.id] = {
      title: thread.title,
      hostId: thread.hostId,
      kind: thread.kind,
    };
  });
  return {
    version: 1,
    projects: {
      [projectId]: {
        groups: [{ id: groupId, name: "长期任务", collapsed, createdAt: 1, updatedAt: 1 }],
        membership,
        threadHints,
      },
    },
  };
}

function boot(memberHints, visibleThreads, options = {}) {
  const window = new Window({ url: "app://-/index.html" });
  const projectRow = window.document.createElement("div");
  projectRow.className = "native-project-row";
  projectRow.setAttribute("data-app-action-sidebar-project-row", "");
  projectRow.setAttribute("data-app-action-sidebar-project-id", projectId);
  projectRow.setAttribute("data-app-action-sidebar-project-label", "Project");
  projectRow.setAttribute("aria-expanded", "true");
  window.document.body.appendChild(projectRow);
  const made = makeProjectList(window, visibleThreads, options);
  window.document.body.appendChild(made.list);
  (options.externalThreads || []).forEach((thread) => {
    window.document.body.appendChild(makeThreadWrapper(window, thread, { pinned: true }));
  });
  window.localStorage.setItem(
    "codex-session-groups:v1",
    JSON.stringify(options.state || savedState(memberHints, options)),
  );
  window.eval(modelSource);
  window.eval(uiSource);
  return { window, projectRow, ...made };
}

function api(window) {
  return window.__CODEX_SESSION_GROUPS_V1__;
}

test("incomplete native rows fail open and recover when Codex loads them", async () => {
  const members = [descriptor("local:t1"), descriptor("local:t2"), descriptor("local:t3")];
  const { window, stack } = boot(members, [members[0]], { collapsed: true, showAll: "true" });
  await delay();

  const firstRow = stack.querySelector('[data-app-action-sidebar-thread-id="local:t1"]');
  const firstWrapper = firstRow.closest('[role="listitem"]');
  const groupRow = stack.querySelector(".csg-group-row");
  assert.equal(groupRow.querySelector(".csg-group-count").textContent, "1/3");
  assert.equal(groupRow.getAttribute("aria-expanded"), "true");
  assert.equal(groupRow.getAttribute("data-csg-incomplete"), "true");
  assert.equal(firstWrapper.hasAttribute("data-csg-hidden"), false);
  assert.equal(firstRow.classList.contains("csg-grouped-thread"), false);
  assert.equal(Object.keys(api(window).getState().projects[projectId].membership).length, 3);
  groupRow.click();
  await delay(30);
  assert.equal(api(window).getState().projects[projectId].groups[0].collapsed, true);

  stack.appendChild(makeThreadWrapper(window, members[1]));
  stack.appendChild(makeThreadWrapper(window, members[2]));
  await delay(150);
  assert.equal(groupRow.querySelector(".csg-group-count").textContent, "3");
  assert.equal(groupRow.getAttribute("data-csg-incomplete"), "false");
  assert.equal(firstWrapper.getAttribute("data-csg-hidden"), "true");
  assert.equal(firstRow.classList.contains("csg-grouped-thread"), true);
  assert.equal(Object.keys(api(window).getState().projects[projectId].membership).length, 3);

  api(window).destroy();
  window.close();
});

test("a remounted or reset native list can reveal members again", async () => {
  const members = [descriptor("local:t1"), descriptor("local:t2"), descriptor("local:t3")];
  let firstClicks = 0;
  const first = boot(members, [members[0]], {
    showAll: "false",
    onShowAll: ({ list, stack, controlItem }) => {
      firstClicks += 1;
      list.setAttribute("data-app-action-sidebar-project-show-all", "true");
      controlItem.remove();
      stack.appendChild(makeThreadWrapper(first.window, members[1]));
      stack.appendChild(makeThreadWrapper(first.window, members[2]));
    },
  });
  await delay(250);
  assert.equal(firstClicks, 1);
  assert.equal(first.stack.querySelector(".csg-group-count").textContent, "3");

  first.list.remove();
  let secondClicks = 0;
  const second = makeProjectList(first.window, [members[0]], {
    showAll: "false",
    onShowAll: ({ list, stack, controlItem }) => {
      secondClicks += 1;
      list.setAttribute("data-app-action-sidebar-project-show-all", "true");
      controlItem.remove();
      stack.appendChild(makeThreadWrapper(first.window, members[1]));
      stack.appendChild(makeThreadWrapper(first.window, members[2]));
    },
  });
  first.window.document.body.appendChild(second.list);
  await delay(300);
  assert.equal(secondClicks, 1);
  assert.equal(second.stack.querySelector(".csg-group-count").textContent, "3");

  second.stack.querySelector('[data-app-action-sidebar-thread-id="local:t2"]').closest('[role="listitem"]').remove();
  second.stack.querySelector('[data-app-action-sidebar-thread-id="local:t3"]').closest('[role="listitem"]').remove();
  second.list.setAttribute("data-app-action-sidebar-project-show-all", "false");
  let resetClicks = 0;
  const controlItem = first.window.document.createElement("div");
  controlItem.setAttribute("role", "listitem");
  const control = first.window.document.createElement("button");
  control.textContent = "展开显示";
  control.addEventListener("click", () => {
    resetClicks += 1;
    second.list.setAttribute("data-app-action-sidebar-project-show-all", "true");
    controlItem.remove();
    second.stack.appendChild(makeThreadWrapper(first.window, members[1]));
    second.stack.appendChild(makeThreadWrapper(first.window, members[2]));
  });
  controlItem.appendChild(control);
  second.stack.appendChild(controlItem);
  await delay(300);
  assert.equal(resetClicks, 1);
  assert.equal(second.stack.querySelector(".csg-group-count").textContent, "3");

  api(first.window).destroy();
  first.window.close();
});

test("archive reconciliation follows a temporary id migration", async () => {
  const temporary = descriptor("local:client-new-thread:temp", "Migrating task");
  const stable = descriptor("local:stable", "Migrating task");
  const { window, list, stack } = boot([temporary], [temporary], { showAll: "true" });
  await delay();
  const row = stack.querySelector('[data-app-action-sidebar-thread-id="local:client-new-thread:temp"]');
  const archive = window.document.createElement("button");
  archive.setAttribute("aria-label", "归档聊天");
  row.appendChild(archive);
  archive.click();

  row.setAttribute("data-app-action-sidebar-thread-id", stable.id);
  row.setAttribute("data-app-action-sidebar-thread-title", stable.title);
  api(window).refresh();
  await delay(50);
  const migratedState = api(window).getState();
  assert.equal(
    migratedState.projects[projectId].membership[stable.id],
    groupId,
    JSON.stringify(migratedState),
  );
  row.closest('[role="listitem"]').remove();
  list.setAttribute("data-app-action-sidebar-project-show-all", "true");
  await delay(900);

  const state = api(window).getState();
  assert.equal(state.projects[projectId].membership[temporary.id], undefined);
  assert.equal(state.projects[projectId].membership[stable.id], undefined);
  assert.equal(state.projects[projectId].groups.length, 1);
  api(window).destroy();
  window.close();
});

test("archive intent resolves a stable row before identity render runs", async () => {
  const temporary = descriptor("local:client-new-thread:temp-reverse", "Reverse migration task");
  const stable = descriptor("local:stable-reverse", "Reverse migration task");
  const { window, stack } = boot([temporary], [temporary], { showAll: "true" });
  await delay();
  const row = stack.querySelector(`[data-app-action-sidebar-thread-id="${temporary.id}"]`);
  const wrapper = row.closest('[role="listitem"]');
  const archive = window.document.createElement("button");
  archive.setAttribute("aria-label", "归档聊天");
  row.appendChild(archive);

  row.setAttribute("data-app-action-sidebar-thread-id", stable.id);
  archive.click();
  wrapper.remove();
  await delay(900);

  const state = api(window).getState();
  assert.equal(state.projects[projectId].membership[temporary.id], undefined);
  assert.equal(state.projects[projectId].membership[stable.id], undefined);
  assert.equal(state.projects[projectId].groups.length, 1);
  api(window).destroy();
  window.close();
});

test("reverse archive fails closed with two matching stable rows in the project", async () => {
  const temporary = descriptor("local:client-new-thread:temp-ambiguous", "Ambiguous reverse task");
  const stableA = descriptor("local:stable-ambiguous-a", "Ambiguous reverse task");
  const stableB = descriptor("local:stable-ambiguous-b", "Ambiguous reverse task");
  const { window, stack } = boot([temporary], [stableA, stableB], { showAll: "true" });
  await delay();

  const row = stack.querySelector(`[data-app-action-sidebar-thread-id="${stableA.id}"]`);
  const archive = window.document.createElement("button");
  archive.setAttribute("aria-label", "归档聊天");
  row.appendChild(archive);
  archive.click();
  assert.equal(api(window).getDiagnostics().membershipChecks, 0);
  row.closest('[role="listitem"]').remove();
  await delay(200);

  const membership = api(window).getState().projects[projectId].membership;
  assert.equal(membership[temporary.id], groupId);
  assert.equal(membership[stableA.id], undefined);
  assert.equal(membership[stableB.id], undefined);
  assert.equal(api(window).getDiagnostics().membershipChecks, 0);
  api(window).destroy();
  window.close();
});

test("reverse archive fails closed when a pinned row matches the stable target", async () => {
  const temporary = descriptor("local:client-new-thread:temp-pinned", "Pinned reverse task");
  const own = descriptor("local:stable-own-reverse", "Pinned reverse task");
  const pinned = descriptor("local:stable-pinned-reverse", "Pinned reverse task");
  const { window, stack } = boot([temporary], [own], {
    showAll: "true",
    externalThreads: [pinned],
  });
  await delay();

  const row = stack.querySelector(`[data-app-action-sidebar-thread-id="${own.id}"]`);
  const archive = window.document.createElement("button");
  archive.setAttribute("aria-label", "归档聊天");
  row.appendChild(archive);
  archive.click();
  assert.equal(api(window).getDiagnostics().membershipChecks, 0);
  row.closest('[role="listitem"]').remove();
  await delay(200);

  const membership = api(window).getState().projects[projectId].membership;
  assert.equal(membership[temporary.id], groupId);
  assert.equal(membership[own.id], undefined);
  assert.equal(membership[pinned.id], undefined);
  assert.equal(api(window).getDiagnostics().membershipChecks, 0);
  api(window).destroy();
  window.close();
});

test("a pinned duplicate blocks temporary id migration", async () => {
  const temporary = descriptor("local:client-new-thread:temp", "Duplicate");
  const own = descriptor("local:stable-own", "Duplicate");
  const pinned = descriptor("local:stable-pinned", "Duplicate");
  const { window } = boot([temporary], [own], { showAll: "true", externalThreads: [pinned] });
  await delay();

  const membership = api(window).getState().projects[projectId].membership;
  assert.equal(membership[temporary.id], groupId);
  assert.equal(membership[own.id], undefined);
  assert.equal(membership[pinned.id], undefined);
  api(window).destroy();
  window.close();
});

test("multiple incomplete groups share one asynchronous reveal click", async () => {
  const memberA = descriptor("local:member-a", "Member A");
  const memberB = descriptor("local:member-b", "Member B");
  const visible = descriptor("local:visible", "Visible ungrouped");
  const state = {
    version: 1,
    projects: {
      [projectId]: {
        groups: [
          { id: "group-a", name: "A", collapsed: false, createdAt: 1, updatedAt: 1 },
          { id: "group-b", name: "B", collapsed: false, createdAt: 1, updatedAt: 1 },
        ],
        membership: { [memberA.id]: "group-a", [memberB.id]: "group-b" },
        threadHints: {
          [memberA.id]: { title: memberA.title, hostId: memberA.hostId, kind: memberA.kind },
          [memberB.id]: { title: memberB.title, hostId: memberB.hostId, kind: memberB.kind },
        },
      },
    },
  };
  let clicks = 0;
  const started = boot([], [visible], {
    state,
    showAll: "false",
    onShowAll: ({ list, stack, controlItem }) => {
      clicks += 1;
      started.window.setTimeout(() => {
        list.setAttribute("data-app-action-sidebar-project-show-all", "true");
        controlItem.remove();
        stack.appendChild(makeThreadWrapper(started.window, memberA));
        stack.appendChild(makeThreadWrapper(started.window, memberB));
      }, 50);
    },
  });
  await delay(350);

  assert.equal(clicks, 1);
  assert.deepEqual(
    Array.from(started.stack.querySelectorAll(".csg-group-count"), (count) => count.textContent),
    ["1", "1"],
  );
  api(started.window).destroy();
  started.window.close();
});

test("remount cleanup releases disconnected wrappers and destroy clears timers", async () => {
  const member = descriptor("local:t1");
  const started = boot([member], [member], { showAll: "true" });
  await delay();
  let currentList = started.list;
  for (let index = 0; index < 12; index += 1) {
    currentList.remove();
    const next = makeProjectList(started.window, [member], { showAll: "true" });
    started.window.document.body.appendChild(next.list);
    currentList = next.list;
    await delay(30);
  }
  await delay(100);
  assert.ok(api(started.window).getDiagnostics().touchedOrderElements <= 2);
  api(started.window).destroy();
  await delay(80);
  assert.deepEqual(api(started.window), undefined);
  assert.equal(started.window.document.getElementById("codex-session-groups-style-v1"), null);
  assert.equal(started.window.document.querySelector(".csg-group-item"), null);
  assert.equal(started.window.document.querySelector(".csg-drag-handle"), null);
  started.window.close();
});
