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

test("a visible show-all control overrides a stale true attribute and is clicked once", async () => {
  const members = [descriptor("local:visible"), descriptor("local:missing-a"), descriptor("local:missing-b")];
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll: ({ stack, controlItem }) => {
      clicks += 1;
      started.window.setTimeout(() => {
        controlItem.remove();
        stack.appendChild(makeThreadWrapper(started.window, members[1]));
        stack.appendChild(makeThreadWrapper(started.window, members[2]));
      }, 50);
    },
  });

  await waitFor(() => clicks === 1);
  started.stack.querySelector(".csg-group-row")?.click();
  await waitFor(() => started.stack.querySelector(".csg-group-count")?.textContent === "3");
  await delay(150);
  assert.equal(clicks, 1);
  assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "false");
  assert.equal(
    started.stack.querySelector('[data-app-action-sidebar-thread-id="local:visible"]')
      .closest('[role="listitem"]')
      .getAttribute("data-csg-hidden"),
    "true",
  );
  api(started.window).destroy();
  started.window.close();
});

test("an unchanged visible show-all control is not clicked repeatedly", async () => {
  const members = [descriptor("local:visible"), descriptor("local:missing")];
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll: () => { clicks += 1; },
  });

  await waitFor(() => clicks === 1);
  started.stack.querySelector(".csg-group-row")?.click();
  started.window.document.body.appendChild(started.window.document.createElement("div"));
  await delay(500);
  assert.equal(clicks, 1);
  assert.equal(started.stack.querySelector(".csg-group-count")?.textContent, "1/2");
  assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "true");
  api(started.window).destroy();
  started.window.close();
});

test("a stale true attribute can page only while native thread ids strictly expand", async () => {
  const members = [descriptor("local:visible"), descriptor("local:page-two"), descriptor("local:page-three")];
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll: ({ stack, controlItem }) => {
      clicks += 1;
      const page = clicks;
      started.window.setTimeout(() => {
        if (page === 1) {
          stack.appendChild(makeThreadWrapper(started.window, members[1]));
          return;
        }
        controlItem.remove();
        stack.appendChild(makeThreadWrapper(started.window, members[2]));
      }, 40);
    },
  });

  await waitFor(() => clicks === 2
    && started.stack.querySelector(".csg-group-count")?.textContent === "3");
  await delay(250);
  assert.equal(clicks, 2);
  assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "false");
  api(started.window).destroy();
  started.window.close();
});

test("removing an external pinned member starts a new reveal chain without changing storage", async () => {
  const visible = descriptor("local:visible");
  const pinned = descriptor("local:pinned");
  let clicks = 0;
  const started = boot([visible, pinned], [visible], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    externalThreads: [pinned],
    onShowAll: ({ stack, controlItem }) => {
      clicks += 1;
      controlItem.remove();
      stack.appendChild(makeThreadWrapper(started.window, pinned));
    },
  });
  await delay(120);
  const storageBefore = started.window.localStorage.getItem("codex-session-groups:v1");
  assert.equal(clicks, 0);
  assert.equal(started.stack.querySelector(".csg-group-count")?.textContent, "1/2");

  Array.from(started.window.document.querySelectorAll('[data-app-action-sidebar-thread-id="local:pinned"]'))
    .find((row) => !started.list.contains(row))
    .closest('[role="listitem"]')
    .remove();
  await waitFor(() => clicks === 1
    && started.stack.querySelector(".csg-group-count")?.textContent === "2");

  assert.equal(clicks, 1);
  assert.equal(started.window.localStorage.getItem("codex-session-groups:v1"), storageBefore);
  assert.equal(Object.keys(api(started.window).getState().projects[projectId].membership).length, 2);
  api(started.window).destroy();
  started.window.close();
});

test("replacing native thread ids after a click halts reveal and stays fail-open", async () => {
  const members = [descriptor("local:visible"), descriptor("local:missing")];
  const replacement = descriptor("local:replacement");
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll: ({ stack }) => {
      clicks += 1;
      started.window.setTimeout(() => {
        stack.querySelector('[data-app-action-sidebar-thread-id="local:visible"]')
          .closest('[role="listitem"]')
          .remove();
        stack.prepend(makeThreadWrapper(started.window, replacement));
      }, 40);
    },
  });

  await waitFor(() => started.stack.querySelector('[data-app-action-sidebar-thread-id="local:replacement"]'));
  started.stack.querySelector(".csg-group-row")?.click();
  await delay(400);
  assert.equal(clicks, 1);
  assert.equal(started.stack.querySelector(".csg-group-count")?.textContent, "0/2");
  assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "true");
  api(started.window).destroy();
  started.window.close();
});

test("disabled and hidden show-all controls are never clicked", async () => {
  for (const controlState of [{ showAllDisabled: true }, { showAllHidden: true }]) {
    const members = [descriptor("local:visible"), descriptor("local:missing")];
    let clicks = 0;
    const started = boot(members, [members[0]], {
      collapsed: true,
      showAll: "true",
      showAllControl: true,
      ...controlState,
      onShowAll: () => { clicks += 1; },
    });
    await delay(150);
    assert.equal(clicks, 0);
    assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "true");
    api(started.window).destroy();
    started.window.close();
  }
});

test("hidden or disabled native show-all controls become eligible when enabled in place", async () => {
  for (const transition of [
    { initial: { showAllHidden: true }, enable: (control) => { control.hidden = false; } },
    { initial: { showAllDisabled: true }, enable: (control) => { control.disabled = false; } },
  ]) {
    const members = [descriptor("local:visible"), descriptor("local:missing")];
    let clicks = 0;
    const started = boot(members, [members[0]], {
      collapsed: true,
      showAll: "true",
      showAllControl: true,
      ...transition.initial,
      onShowAll: ({ stack, controlItem }) => {
        clicks += 1;
        controlItem.remove();
        stack.appendChild(makeThreadWrapper(started.window, members[1]));
      },
    });
    await delay(150);
    assert.equal(clicks, 0);

    const control = Array.from(started.stack.querySelectorAll("button"))
      .find((candidate) => candidate.textContent.trim() === "展开显示");
    transition.enable(control);
    await waitFor(() => clicks === 1
      && started.stack.querySelector(".csg-group-count")?.textContent === "2");
    await delay(150);
    assert.equal(clicks, 1);
    api(started.window).destroy();
    started.window.close();
  }
});

test("a disabled non-form role button is not clicked until its attribute is removed", async () => {
  const members = [descriptor("local:visible"), descriptor("local:role-button-missing")];
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    showAllDisabled: true,
    showAllRoleButton: true,
    onShowAll: ({ stack, controlItem }) => {
      clicks += 1;
      controlItem.remove();
      stack.appendChild(makeThreadWrapper(started.window, members[1]));
    },
  });
  await delay(150);
  assert.equal(clicks, 0);

  started.stack.querySelector("[role='button'][disabled]").removeAttribute("disabled");
  await waitFor(() => clicks === 1
    && started.stack.querySelector(".csg-group-count")?.textContent === "2");
  await delay(150);
  assert.equal(clicks, 1);
  api(started.window).destroy();
  started.window.close();
});

test("injected groups named like show-all controls never click themselves", async () => {
  for (const injectedName of ["展开显示", "show all"]) {
    const missing = descriptor(`local:missing-${injectedName}`);
    const visible = descriptor(`local:visible-${injectedName}`);
    const state = {
      version: 1,
      projects: {
        [projectId]: {
          groups: [
            { id: "empty", name: injectedName, collapsed: false, createdAt: 1, updatedAt: 1 },
            { id: "work", name: "Work", collapsed: false, createdAt: 2, updatedAt: 2 },
          ],
          membership: { [missing.id]: "work" },
          threadHints: {
            [missing.id]: { title: missing.title, hostId: missing.hostId, kind: missing.kind },
          },
        },
      },
    };
    let injectedGroupClicks = 0;
    const started = boot([], [visible], {
      state,
      showAll: "true",
      showAllControl: false,
      onDocumentClick: (event) => {
        if (event.target.closest?.(".csg-group-row")) injectedGroupClicks += 1;
      },
    });
    const storageBefore = started.window.localStorage.getItem("codex-session-groups:v1");
    await delay(300);

    assert.equal(injectedGroupClicks, 0);
    assert.equal(started.window.document.querySelector(".csg-toast"), null);
    assert.equal(started.window.localStorage.getItem("codex-session-groups:v1"), storageBefore);
    api(started.window).destroy();
    started.window.close();
  }
});

test("a native show-all control appearing after the initial wait timeout remains eligible", async () => {
  const members = [descriptor("local:visible"), descriptor("local:slow-missing")];
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "false",
    showAllControl: false,
  });

  await delay(2_300);
  const controlItem = started.window.document.createElement("div");
  controlItem.setAttribute("role", "listitem");
  const control = started.window.document.createElement("button");
  control.textContent = "展开显示";
  control.addEventListener("click", () => {
    clicks += 1;
    controlItem.remove();
    started.stack.appendChild(makeThreadWrapper(started.window, members[1]));
  });
  controlItem.appendChild(control);
  started.stack.appendChild(controlItem);

  await waitFor(() => clicks === 1
    && started.stack.querySelector(".csg-group-count")?.textContent === "2");
  assert.equal(clicks, 1);
  api(started.window).destroy();
  started.window.close();
});

test("project reveal pagination stops at the total click cap", async () => {
  const members = Array.from({ length: 10 }, (_, index) => descriptor(`local:page-${index}`));
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll: ({ stack }) => {
      clicks += 1;
      stack.appendChild(makeThreadWrapper(started.window, members[clicks]));
    },
  });

  await waitFor(() => clicks === 8);
  await delay(400);
  assert.equal(clicks, 8);
  assert.equal(started.stack.querySelector(".csg-group-count")?.textContent, "9/10");
  assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "true");
  api(started.window).destroy();
  started.window.close();
});

test("a no-progress list remount cannot reset the reveal latch", async () => {
  const members = [descriptor("local:visible"), descriptor("local:missing")];
  let clicks = 0;
  let started;
  let currentList;
  const onShowAll = () => {
    clicks += 1;
    const next = makeProjectList(started.window, [members[0]], {
      showAll: "true",
      showAllControl: true,
      onShowAll,
    });
    currentList.remove();
    started.window.document.body.appendChild(next.list);
    currentList = next.list;
  };
  started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll,
  });
  currentList = started.list;

  await waitFor(() => clicks === 1);
  await delay(1_200);
  assert.equal(clicks, 1);
  assert.equal(started.window.document.querySelector(".csg-group-count")?.textContent, "1/2");
  api(started.window).destroy();
  started.window.close();
});

test("project reveal click budget survives progress remounts", async () => {
  const members = Array.from({ length: 10 }, (_, index) => descriptor(`local:remount-page-${index}`));
  let clicks = 0;
  let started;
  let currentList;
  const onShowAll = () => {
    clicks += 1;
    const next = makeProjectList(started.window, members.slice(0, clicks + 1), {
      showAll: "true",
      showAllControl: true,
      onShowAll,
    });
    currentList.remove();
    started.window.document.body.appendChild(next.list);
    currentList = next.list;
  };
  started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: true,
    onShowAll,
  });
  currentList = started.list;

  await waitFor(() => clicks === 8);
  await delay(500);
  assert.equal(clicks, 8);
  assert.equal(started.window.document.querySelector(".csg-group-count")?.textContent, "9/10");
  api(started.window).destroy();
  started.window.close();
});

test("a stale true attribute without a show-all control does not click and stays fail-open", async () => {
  const members = [descriptor("local:visible"), descriptor("local:missing")];
  let clicks = 0;
  const started = boot(members, [members[0]], {
    collapsed: true,
    showAll: "true",
    showAllControl: false,
    onShowAll: () => { clicks += 1; },
  });

  await delay(200);
  const visibleRow = started.stack.querySelector('[data-app-action-sidebar-thread-id="local:visible"]');
  assert.equal(clicks, 0);
  assert.equal(started.stack.querySelector(".csg-group-count")?.textContent, "1/2");
  assert.equal(started.stack.querySelector(".csg-group-row")?.getAttribute("data-csg-incomplete"), "true");
  assert.equal(visibleRow.closest('[role="listitem"]').hasAttribute("data-csg-hidden"), false);
  assert.equal(visibleRow.classList.contains("csg-grouped-thread"), false);
  assert.equal(Object.keys(api(started.window).getState().projects[projectId].membership).length, 2);
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

test("a remounted or newly incomplete native list can reveal members again", async () => {
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
  await first.window.happyDOM.waitUntilComplete();
  await waitFor(() => firstClicks === 1
    && first.stack.querySelector(".csg-group-count")?.textContent === "3");
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
  await first.window.happyDOM.waitUntilComplete();
  await waitFor(() => secondClicks === 1
    && second.stack.querySelector(".csg-group-count")?.textContent === "3");
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
  await first.window.happyDOM.waitUntilComplete();
  await waitFor(() => resetClicks === 1
    && second.stack.querySelector(".csg-group-count")?.textContent === "3");
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
