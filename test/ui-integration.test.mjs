import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const modelSource = await readFile(new URL("../inject/model.js", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../inject/session-groups.user.js", import.meta.url), "utf8");
const projectId = "project";
const groupId = "group-a";

const delay = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(20);
}

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

function makeProjectList(
  window,
  threads,
  {
    showAll = "true",
    showAllControl = showAll === "false",
    showAllDisabled = false,
    showAllHidden = false,
    showAllRoleButton = false,
    onShowAll = null,
  } = {},
) {
  const list = window.document.createElement("div");
  list.setAttribute("data-app-action-sidebar-project-list-id", projectId);
  list.setAttribute("data-app-action-sidebar-project-show-all", showAll);
  const stack = window.document.createElement("div");
  stack.setAttribute("role", "list");
  threads.forEach((thread) => stack.appendChild(makeThreadWrapper(window, thread)));
  if (showAllControl) {
    const controlItem = window.document.createElement("div");
    controlItem.setAttribute("role", "listitem");
    const control = window.document.createElement(showAllRoleButton ? "div" : "button");
    if (showAllRoleButton) control.setAttribute("role", "button");
    control.textContent = "展开显示";
    if (showAllDisabled) {
      if ("disabled" in control) control.disabled = true;
      else control.setAttribute("disabled", "");
    }
    control.hidden = showAllHidden;
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
  if (options.onDocumentClick) {
    window.document.addEventListener("click", options.onDocumentClick);
  }
  window.eval(modelSource);
  window.eval(uiSource);
  return { window, projectRow, ...made };
}

function api(window) {
  return window.__CODEX_SESSION_GROUPS_V1__;
}

test("native project menu gets one owned folder-plus item across refresh and remount", async () => {
  const emptyState = { version: 1, projects: {} };
  const started = boot([], [], { state: emptyState, showAll: "true" });
  const { window, projectRow } = started;
  const menuId = "native-project-menu";
  const trigger = window.document.createElement("button");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("data-state", "open");
  projectRow.appendChild(trigger);

  let nativeClicks = 0;
  const makeNativeMenu = ({ structured = true } = {}) => {
    const menu = window.document.createElement("div");
    menu.id = menuId;
    menu.setAttribute("role", "menu");
    const editItem = window.document.createElement("div");
    editItem.className = "native-menu-item group";
    editItem.setAttribute("role", "menuitem");
    if (structured) {
      const content = window.document.createElement("div");
      content.className = "flex w-full items-center gap-1.5";
      const icon = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute(
        "class",
        "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100",
      );
      const label = window.document.createElement("span");
      label.className = "flex-1 min-w-0 truncate";
      label.textContent = "编辑项目";
      content.append(icon, label);
      editItem.appendChild(content);
    } else {
      editItem.textContent = "编辑项目";
    }
    editItem.addEventListener("click", () => { nativeClicks += 1; });
    menu.appendChild(editItem);
    window.document.body.appendChild(menu);
    return { menu, editItem };
  };

  const first = makeNativeMenu();
  api(window).refresh();
  await waitFor(() => first.menu.querySelector('[data-csg-create-group="true"]'));
  const firstItem = first.menu.querySelector('[data-csg-create-group="true"]');
  const firstContent = firstItem.firstElementChild;
  const firstIcon = firstContent.children[0];
  const firstLabel = firstContent.children[1];
  assert.notEqual(firstItem, first.editItem);
  assert.equal(firstItem.className, first.editItem.className);
  assert.equal(firstItem.getAttribute("role"), "menuitem");
  assert.equal(firstItem.hasAttribute("data-radix-collection-item"), true);
  assert.equal(firstItem.tabIndex, -1);
  assert.equal(firstContent.tagName, "DIV");
  assert.equal(firstContent.className, "flex w-full items-center gap-1.5");
  assert.equal(firstContent.children.length, 2);
  assert.equal(firstIcon.tagName.toLowerCase(), "svg");
  assert.equal(
    firstIcon.getAttribute("class"),
    "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100",
  );
  assert.equal(firstIcon.getAttribute("width"), "20");
  assert.equal(firstIcon.getAttribute("height"), "20");
  assert.equal(firstIcon.getAttribute("stroke"), "currentColor");
  assert.equal(firstIcon.getAttribute("aria-hidden"), "true");
  assert.equal(firstIcon.getAttribute("focusable"), "false");
  assert.equal(firstIcon.hasAttribute("tabindex"), false);
  assert.equal(firstIcon.querySelectorAll("path").length, 3);
  assert.equal(firstLabel.tagName, "SPAN");
  assert.equal(firstLabel.className, "flex-1 min-w-0 truncate");
  assert.equal(firstLabel.textContent, "新建分组");
  assert.equal(
    firstItem.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])').length,
    0,
  );

  const bubbledKeys = [];
  const recordKey = (event) => bubbledKeys.push({ key: event.key, defaultPrevented: event.defaultPrevented });
  window.document.addEventListener("keydown", recordKey);
  for (const key of ["ArrowDown", "Escape"]) {
    firstItem.dispatchEvent(new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }));
  }
  window.document.removeEventListener("keydown", recordKey);
  assert.deepEqual(bubbledKeys, [
    { key: "ArrowDown", defaultPrevented: false },
    { key: "Escape", defaultPrevented: false },
  ]);

  api(window).refresh();
  api(window).refresh();
  await delay(80);
  assert.equal(first.menu.querySelectorAll('[data-csg-create-group="true"]').length, 1);
  assert.equal(first.menu.querySelector('[data-csg-create-group="true"]'), firstItem);
  assert.equal(firstItem.firstElementChild, firstContent);

  first.menu.remove();
  const remounted = makeNativeMenu({ structured: false });
  api(window).refresh();
  api(window).refresh();
  await waitFor(() => remounted.menu.querySelector('[data-csg-create-group="true"]'));
  const remountedItems = remounted.menu.querySelectorAll('[data-csg-create-group="true"]');
  assert.equal(remountedItems.length, 1);
  assert.equal(firstItem.isConnected, false);
  assert.notEqual(remountedItems[0], firstItem);
  assert.equal(remountedItems[0].firstElementChild.className, "flex w-full items-center gap-1.5");
  assert.equal(
    remountedItems[0].querySelector("svg").getAttribute("class"),
    "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100",
  );
  assert.equal(remountedItems[0].querySelector("span").className, "flex-1 min-w-0 truncate");

  remountedItems[0].querySelector("svg").dispatchEvent(new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  }));
  await waitFor(() => api(window).getState().projects[projectId]?.groups.length === 1);
  assert.equal(nativeClicks, 0);
  await waitFor(() => started.stack.querySelector(".csg-name-input"));
  const editor = started.stack.querySelector(".csg-name-input");
  assert.ok(editor);
  editor.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  }));
  await waitFor(() => !api(window).getState().projects[projectId]);
  assert.equal(Object.keys(api(window).getState().projects).length, 0);

  api(window).destroy();
  assert.equal(remounted.menu.querySelector('[data-csg-create-group="true"]'), null);
  assert.equal(remounted.editItem.isConnected, true);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("codex-session-groups:v1")).projects, {});
  window.close();
});

test("a group projects only its currently visible members", async () => {
  const members = [descriptor("local:t1"), descriptor("local:t2"), descriptor("local:t3")];
  const { window, stack } = boot(members, [members[0]], { collapsed: true, showAll: "true" });
  await delay();

  const firstRow = stack.querySelector('[data-app-action-sidebar-thread-id="local:t1"]');
  const firstWrapper = firstRow.closest('[role="listitem"]');
  const groupRow = stack.querySelector(".csg-group-row");
  assert.equal(groupRow.querySelector(".csg-group-count").textContent, "1");
  assert.equal(groupRow.getAttribute("aria-expanded"), "false");
  assert.equal(groupRow.hasAttribute("data-csg-incomplete"), false);
  assert.equal(firstWrapper.getAttribute("data-csg-hidden"), "true");
  assert.equal(firstRow.classList.contains("csg-grouped-thread"), true);
  assert.equal(Object.keys(api(window).getState().projects[projectId].membership).length, 3);
  groupRow.click();
  await waitFor(() => api(window).getState().projects[projectId].groups[0].collapsed === false);
  await delay(80);
  assert.equal(firstWrapper.hasAttribute("data-csg-hidden"), false);

  stack.appendChild(makeThreadWrapper(window, members[1]));
  stack.appendChild(makeThreadWrapper(window, members[2]));
  api(window).refresh();
  await delay(150);
  assert.equal(groupRow.querySelector(".csg-group-count").textContent, "3");
  assert.equal(groupRow.hasAttribute("data-csg-incomplete"), false);
  assert.equal(firstWrapper.hasAttribute("data-csg-hidden"), false);
  assert.equal(firstRow.classList.contains("csg-grouped-thread"), true);
  assert.equal(Object.keys(api(window).getState().projects[projectId].membership).length, 3);

  api(window).destroy();
  window.close();
});

test("missing saved members neither block groups nor click native show-more", async () => {
  const complete = descriptor("local:complete");
  const visibleIncomplete = descriptor("local:incomplete-visible");
  const missingIncomplete = descriptor("local:incomplete-missing");
  const completeGroupId = "group-complete";
  const incompleteGroupId = "group-incomplete";
  const state = {
    version: 1,
    projects: {
      [projectId]: {
        groups: [
          { id: completeGroupId, name: "Complete", collapsed: true, createdAt: 1, updatedAt: 1 },
          { id: incompleteGroupId, name: "Incomplete", collapsed: true, createdAt: 2, updatedAt: 2 },
        ],
        membership: {
          [complete.id]: completeGroupId,
          [visibleIncomplete.id]: incompleteGroupId,
          [missingIncomplete.id]: incompleteGroupId,
        },
        threadHints: Object.fromEntries(
          [complete, visibleIncomplete, missingIncomplete].map((thread) => [thread.id, {
            title: thread.title,
            hostId: thread.hostId,
            kind: thread.kind,
          }]),
        ),
      },
    },
  };
  let showMoreClicks = 0;
  const started = boot([], [complete, visibleIncomplete], {
    state,
    showAll: "true",
    showAllControl: true,
    onShowAll: () => { showMoreClicks += 1; },
  });
  await delay(150);

  const completeRow = started.stack.querySelector(
    `.csg-group-row[data-csg-group-id="${completeGroupId}"]`,
  );
  const incompleteRow = started.stack.querySelector(
    `.csg-group-row[data-csg-group-id="${incompleteGroupId}"]`,
  );
  const completeWrapper = started.stack.querySelector(
    `[data-app-action-sidebar-thread-id="${complete.id}"]`,
  ).closest('[role="listitem"]');
  const incompleteWrapper = started.stack.querySelector(
    `[data-app-action-sidebar-thread-id="${visibleIncomplete.id}"]`,
  ).closest('[role="listitem"]');

  assert.equal(completeRow.getAttribute("aria-expanded"), "false");
  assert.equal(completeRow.hasAttribute("data-csg-incomplete"), false);
  assert.equal(completeWrapper.getAttribute("data-csg-hidden"), "true");
  assert.equal(incompleteRow.getAttribute("aria-expanded"), "false");
  assert.equal(incompleteRow.hasAttribute("data-csg-incomplete"), false);
  assert.equal(incompleteRow.querySelector(".csg-group-count").textContent, "1");
  assert.equal(incompleteWrapper.getAttribute("data-csg-hidden"), "true");
  assert.equal(showMoreClicks, 0);

  completeRow.click();
  await waitFor(() => api(started.window).getState()
    .projects[projectId].groups.find((group) => group.id === completeGroupId)?.collapsed === false);
  await delay(80);
  assert.equal(completeWrapper.hasAttribute("data-csg-hidden"), false);

  const membershipBefore = api(started.window).getState().projects[projectId].membership;
  incompleteRow.click();
  await waitFor(() => api(started.window).getState()
    .projects[projectId].groups.find((group) => group.id === incompleteGroupId)?.collapsed === false);
  await delay(80);
  assert.equal(incompleteWrapper.hasAttribute("data-csg-hidden"), false);
  assert.deepEqual(api(started.window).getState().projects[projectId].membership, membershipBefore);
  assert.equal(showMoreClicks, 0);
  assert.equal(started.window.document.querySelector(".csg-toast"), null);

  api(started.window).destroy();
  started.window.close();
});

test("a managed hidden row fails open after losing its native thread id", async () => {
  const member = descriptor("local:loses-native-id");
  const { window, stack } = boot([member], [member], {
    collapsed: true,
    showAll: "true",
    externalThreads: [member],
  });
  await delay();

  const row = stack.querySelector(`[data-app-action-sidebar-thread-id="${member.id}"]`);
  const wrapper = row.closest('[role="listitem"]');
  assert.equal(wrapper.getAttribute("data-csg-hidden"), "true");
  assert.equal(wrapper.getAttribute("data-csg-managed-thread-wrapper"), "true");
  assert.equal(row.getAttribute("data-csg-managed-thread-row"), "true");
  assert.ok(row.querySelector(":scope > .csg-drag-handle"));

  row.removeAttribute("data-app-action-sidebar-thread-id");
  await delay(80);

  assert.equal(wrapper.hasAttribute("data-csg-hidden"), false);
  assert.equal(wrapper.hasAttribute("data-csg-managed-thread-wrapper"), false);
  assert.equal(wrapper.style.order, "");
  assert.equal(row.hasAttribute("data-csg-managed-thread-row"), false);
  assert.equal(row.classList.contains("csg-grouped-thread"), false);
  assert.equal(row.classList.contains("csg-thread-row"), false);
  assert.equal(row.querySelector(":scope > .csg-drag-handle"), null);
  api(window).destroy();
  window.close();
});

test("destroy cleans a managed hidden row after its native thread id disappears", async () => {
  const member = descriptor("local:destroy-after-id-loss");
  const { window, stack } = boot([member], [member], { collapsed: true, showAll: "true" });
  await delay();

  const row = stack.querySelector(`[data-app-action-sidebar-thread-id="${member.id}"]`);
  const wrapper = row.closest('[role="listitem"]');
  row.removeAttribute("data-app-action-sidebar-thread-id");
  api(window).destroy();

  assert.equal(wrapper.hasAttribute("data-csg-hidden"), false);
  assert.equal(wrapper.hasAttribute("data-csg-managed-thread-wrapper"), false);
  assert.equal(wrapper.style.order, "");
  assert.equal(row.hasAttribute("data-csg-managed-thread-row"), false);
  assert.equal(row.classList.contains("csg-grouped-thread"), false);
  assert.equal(row.classList.contains("csg-thread-row"), false);
  assert.equal(row.querySelector(":scope > .csg-drag-handle"), null);
  window.close();
});

test("a remounted native list projects only the rows Codex currently renders", async () => {
  const members = [descriptor("local:t1"), descriptor("local:t2"), descriptor("local:t3")];
  let firstClicks = 0;
  const first = boot(members, [members[0]], {
    showAll: "false",
    onShowAll: () => { firstClicks += 1; },
  });
  await first.window.happyDOM.waitUntilComplete();
  assert.equal(firstClicks, 0);
  assert.equal(first.stack.querySelector(".csg-group-count").textContent, "1");

  first.list.remove();
  let secondClicks = 0;
  const second = makeProjectList(first.window, [members[0], members[1]], {
    showAll: "false",
    onShowAll: () => { secondClicks += 1; },
  });
  first.window.document.body.appendChild(second.list);
  api(first.window).refresh();
  await first.window.happyDOM.waitUntilComplete();
  await waitFor(() => second.stack.querySelector(".csg-group-count")?.textContent === "2");
  assert.equal(secondClicks, 0);
  assert.equal(second.stack.querySelector(".csg-group-count").textContent, "2");
  assert.equal(Object.keys(api(first.window).getState().projects[projectId].membership).length, 3);

  api(first.window).destroy();
  first.window.close();
});

test("same-row temporary id migration works while other saved members are not rendered", async () => {
  const temporary = descriptor("local:client-new-thread:exact-visible", "Exact visible task");
  const stable = descriptor("local:stable-exact-visible", "Exact visible task");
  const missing = descriptor("local:stable-not-rendered", "Saved but not rendered");
  let showAllClicks = 0;
  const { window, stack } = boot([temporary, missing], [temporary], {
    showAll: "false",
    onShowAll: () => { showAllClicks += 1; },
  });
  await delay();

  const row = stack.querySelector(`[data-app-action-sidebar-thread-id="${temporary.id}"]`);
  assert.equal(row.dataset.csgProjectId, projectId);
  assert.equal(row.dataset.csgGroupId, groupId);
  assert.equal(row.querySelector(":scope > .csg-drag-handle").dataset.csgThreadId, temporary.id);

  row.setAttribute("data-app-action-sidebar-thread-id", stable.id);
  api(window).refresh();
  await waitFor(() => api(window).getState().projects[projectId].membership[stable.id] === groupId);

  const state = api(window).getState().projects[projectId];
  assert.equal(state.membership[temporary.id], undefined);
  assert.equal(state.membership[stable.id], groupId);
  assert.equal(state.membership[missing.id], groupId);
  assert.equal(stack.querySelector(".csg-group-count").textContent, "1");
  assert.equal(row.querySelector(":scope > .csg-drag-handle").dataset.csgThreadId, stable.id);
  assert.equal(showAllClicks, 0);
  api(window).destroy();
  window.close();
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
  assert.equal(api(window).getDiagnostics().membershipChecks, 1);
  wrapper.remove();
  await delay(900);

  const state = api(window).getState();
  assert.equal(state.projects[projectId].membership[temporary.id], undefined);
  assert.equal(state.projects[projectId].membership[stable.id], undefined);
  assert.equal(state.projects[projectId].groups.length, 1);
  api(window).destroy();
  window.close();
});

test("an ambiguous reverse archive stays blocked across a renderer restart", async () => {
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
  assert.equal(
    api(window).getState().projects[projectId].migrationBlocks[temporary.id].reason,
    "ambiguous-archive-target",
  );
  row.closest('[role="listitem"]').remove();
  await delay(200);

  const firstState = api(window).getState();
  const membership = firstState.projects[projectId].membership;
  assert.equal(membership[temporary.id], groupId);
  assert.equal(membership[stableA.id], undefined);
  assert.equal(membership[stableB.id], undefined);
  assert.equal(api(window).getDiagnostics().membershipChecks, 0);
  const persisted = JSON.parse(window.localStorage.getItem("codex-session-groups:v1"));
  api(window).destroy();
  window.close();

  const restarted = boot([], [stableB], { showAll: "true", state: persisted });
  await delay(200);
  const restartedProject = api(restarted.window).getState().projects[projectId];
  assert.equal(restartedProject.membership[temporary.id], groupId);
  assert.equal(restartedProject.membership[stableA.id], undefined);
  assert.equal(restartedProject.membership[stableB.id], undefined);
  assert.equal(
    restartedProject.migrationBlocks[temporary.id].reason,
    "ambiguous-archive-target",
  );
  api(restarted.window).destroy();
  restarted.window.close();
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
  assert.equal(
    api(window).getState().projects[projectId].migrationBlocks[temporary.id].reason,
    "ambiguous-archive-target",
  );
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

test("archiving a pinned stable row durably blocks a stale transient mapping", async () => {
  const temporary = descriptor("local:client-new-thread:temp-pinned-archive", "Pinned archive task");
  const pinned = descriptor("local:stable-pinned-archive", "Pinned archive task");
  const first = boot([temporary], [], {
    showAll: "true",
    externalThreads: [pinned],
  });
  await delay();

  const row = first.window.document.querySelector(
    `[data-app-action-sidebar-thread-id="${pinned.id}"]`,
  );
  assert.equal(row.closest("[data-app-action-sidebar-project-list-id]"), null);
  const archive = first.window.document.createElement("button");
  archive.setAttribute("aria-label", "归档聊天");
  row.appendChild(archive);
  archive.click();
  assert.equal(api(first.window).getDiagnostics().membershipChecks, 0);
  assert.equal(
    api(first.window).getState().projects[projectId].migrationBlocks[temporary.id].reason,
    "ambiguous-archive-target",
  );
  row.closest('[role="listitem"]').remove();
  await delay(100);

  const persisted = JSON.parse(first.window.localStorage.getItem("codex-session-groups:v1"));
  api(first.window).destroy();
  first.window.close();

  const restarted = boot([], [pinned], { showAll: "true", state: persisted });
  await delay(200);
  const project = api(restarted.window).getState().projects[projectId];
  assert.equal(project.membership[temporary.id], groupId);
  assert.equal(project.membership[pinned.id], undefined);
  assert.equal(project.migrationBlocks[temporary.id].reason, "ambiguous-archive-target");
  api(restarted.window).destroy();
  restarted.window.close();
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

test("remount cleanup releases disconnected wrappers and destroy clears runtime state", async () => {
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
