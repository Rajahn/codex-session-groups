(() => {
  "use strict";

  const GLOBAL_KEY = "__CODEX_SESSION_GROUPS_V1__";
  const MODEL_KEY = "__CODEX_SESSION_GROUPS_MODEL_V1__";
  const STORAGE_KEY = "codex-session-groups:v1";
  const STYLE_ID = "codex-session-groups-style-v1";
  const VERSION = "0.1.9";
  const PROJECT_ROW_SELECTOR = "[data-app-action-sidebar-project-row]";
  const PROJECT_LIST_SELECTOR = "[data-app-action-sidebar-project-list-id]";
  const THREAD_ROW_SELECTOR = "[data-app-action-sidebar-thread-id]";
  const MANAGED_THREAD_ROW_SELECTOR = '[data-csg-managed-thread-row="true"]';
  const MANAGED_THREAD_WRAPPER_SELECTOR = '[data-csg-managed-thread-wrapper="true"]';
  const ARCHIVE_LABEL_PATTERN = /^(?:归档聊天|archive chat)$/i;
  const CREATE_GROUP_CONTENT_CLASS = "flex w-full items-center gap-1.5";
  const CREATE_GROUP_ICON_CLASS = "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100";
  const CREATE_GROUP_LABEL_CLASS = "flex-1 min-w-0 truncate";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

  if (location.protocol !== "app:") return;
  const existing = globalThis[GLOBAL_KEY];
  if (existing?.version === VERSION) return;
  try { existing?.destroy?.(); } catch (_) {}
  const model = globalThis[MODEL_KEY];
  if (!model || model.IMPLEMENTATION_VERSION !== VERSION) return;

  let state = loadState();
  let observer = null;
  let renderFrame = 0;
  let rendering = false;
  let destroyed = false;
  let activeProjectMenuId = "";
  let editingGroup = null;
  let dragSession = null;
  let dropTarget = null;
  let groupMenu = null;
  let toastTimer = 0;
  const originalOrders = new WeakMap();
  const orphanedManagedWrappers = new WeakSet();
  const touchedOrderElements = new Set();
  const membershipChecks = new Map();

  const folderIcon = `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.25A1.75 1.75 0 0 1 3.75 2.5h2.08c.45 0 .87.17 1.19.48l.77.77h4.46A1.75 1.75 0 0 1 14 5.5v5.25a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 10.75v-6.5Z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>
    </svg>`;
  const chevronIcon = `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6.25 4.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const moreIcon = `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4.5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor"/>
    </svg>`;
  const gripIcon = `
    <svg viewBox="0 0 12 16" aria-hidden="true">
      <circle cx="3.5" cy="4" r="1" fill="currentColor"/><circle cx="8.5" cy="4" r="1" fill="currentColor"/>
      <circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8.5" cy="8" r="1" fill="currentColor"/>
      <circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="8.5" cy="12" r="1" fill="currentColor"/>
    </svg>`;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return model.normalizeState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      console.warn("[session-groups] Failed to read saved state", error);
      return model.emptyState();
    }
  }

  function saveState(nextState) {
    state = model.normalizeState(nextState);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("[session-groups] Failed to save state", error);
    }
    scheduleRender();
    return state;
  }

  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  function projectRows() {
    return Array.from(document.querySelectorAll(PROJECT_ROW_SELECTOR));
  }

  function projectIdForRow(row) {
    return row?.getAttribute("data-app-action-sidebar-project-id")?.trim() || "";
  }

  function projectLabelForRow(row) {
    return row?.getAttribute("data-app-action-sidebar-project-label")?.trim()
      || row?.getAttribute("aria-label")?.trim()
      || "项目";
  }

  function projectList(projectId) {
    return Array.from(document.querySelectorAll(PROJECT_LIST_SELECTOR)).find(
      (list) => list.getAttribute("data-app-action-sidebar-project-list-id") === projectId,
    ) || null;
  }

  function projectRow(projectId) {
    return projectRows().find((row) => projectIdForRow(row) === projectId) || null;
  }

  function projectConfig(projectId) {
    return state.projects[projectId] || { groups: [], membership: {}, threadHints: {} };
  }

  function groupConfig(projectId, groupId) {
    return projectConfig(projectId).groups.find((group) => group.id === groupId) || null;
  }

  function threadIdForRow(row) {
    return row?.getAttribute("data-app-action-sidebar-thread-id")?.trim() || "";
  }

  function threadDescriptorForRow(row) {
    const id = threadIdForRow(row);
    const title = row?.getAttribute("data-app-action-sidebar-thread-title")?.trim()
      || row?.getAttribute("aria-label")?.trim()
      || "";
    if (!id || !title) return null;
    return {
      id,
      title,
      hostId: row.getAttribute("data-app-action-sidebar-thread-host-id")?.trim() || "",
      kind: row.getAttribute("data-app-action-sidebar-thread-kind")?.trim() || "",
    };
  }

  function membershipKey(projectId, threadId) {
    return `${projectId}\u0000${threadId}`;
  }

  function membershipContext(threadId, preferredProjectId = "") {
    if (!threadId) return null;
    const candidateIds = preferredProjectId
      ? [preferredProjectId, ...Object.keys(state.projects).filter((id) => id !== preferredProjectId)]
      : Object.keys(state.projects);
    for (const projectId of candidateIds) {
      const groupId = projectConfig(projectId).membership[threadId] || "";
      if (groupId) return { projectId, threadId, groupId };
    }
    return null;
  }

  function sameThreadHint(hint, descriptor) {
    return Boolean(hint && descriptor
      && hint.title === descriptor.title
      && hint.hostId === descriptor.hostId
      && hint.kind === descriptor.kind);
  }

  function transientAliasContextForRow(row, preferredProjectId) {
    const descriptor = threadDescriptorForRow(row);
    if (!preferredProjectId || !descriptor || model.isTransientThreadId(descriptor.id)) return null;
    if (row.dataset.csgProjectId !== preferredProjectId) return null;
    const handle = row.querySelector(":scope > .csg-drag-handle[data-csg-thread-id]");
    if (!handle || handle.dataset.csgProjectId !== preferredProjectId) return null;
    const threadId = handle.dataset.csgThreadId?.trim() || "";
    if (!model.isTransientThreadId(threadId) || threadId === descriptor.id) return null;
    const config = projectConfig(preferredProjectId);
    const groupId = config.membership[threadId] || "";
    if (!groupId || row.dataset.csgGroupId !== groupId) return null;
    if (!sameThreadHint(config.threadHints[threadId], descriptor)) return null;
    return { projectId: preferredProjectId, threadId, groupId };
  }

  function matchingTransientMembershipSourcesForRow(row, preferredProjectId) {
    const descriptor = threadDescriptorForRow(row);
    if (!descriptor || model.isTransientThreadId(descriptor.id)) return [];
    const projectIds = preferredProjectId ? [preferredProjectId] : Object.keys(state.projects);
    return projectIds.flatMap((projectId) => {
      const config = projectConfig(projectId);
      return Object.keys(config.membership)
        .filter((threadId) => (
          model.isTransientThreadId(threadId)
          && sameThreadHint(config.threadHints[threadId], descriptor)
        ))
        .map((threadId) => ({ projectId, threadId }));
    });
  }

  function blockFingerprintMigrationSources(row, preferredProjectId) {
    const sources = matchingTransientMembershipSourcesForRow(row, preferredProjectId);
    if (sources.length === 0) return [];
    const threadIdsByProject = new Map();
    sources.forEach(({ projectId, threadId }) => {
      const threadIds = threadIdsByProject.get(projectId) || [];
      threadIds.push(threadId);
      threadIdsByProject.set(projectId, threadIds);
    });
    let nextState = state;
    const blocked = [];
    threadIdsByProject.forEach((threadIds, projectId) => {
      const result = model.blockThreadMigrations(
        nextState,
        projectId,
        threadIds,
        "ambiguous-archive-target",
      );
      nextState = result.state;
      blocked.push(...result.threadIds.map((threadId) => ({ projectId, threadId })));
    });
    if (blocked.length > 0) saveState(nextState);
    return blocked;
  }

  function threadExistsAnywhere(threadId) {
    return Array.from(document.querySelectorAll(THREAD_ROW_SELECTOR)).some(
      (row) => threadIdForRow(row) === threadId,
    );
  }

  function threadRowsAnywhere() {
    return Array.from(document.querySelectorAll(THREAD_ROW_SELECTOR));
  }

  function listStack(list) {
    if (!list) return null;
    const lists = Array.from(list.querySelectorAll('[role="list"]'));
    return lists.find((candidate) => candidate.querySelector(THREAD_ROW_SELECTOR))
      || lists[0]
      || null;
  }

  function directThreadWrapper(row, stack) {
    const wrapper = row?.closest?.('[role="listitem"]');
    return wrapper?.parentElement === stack ? wrapper : null;
  }

  function syncProjectThreadIdentities(projectId, list, nativeRows) {
    const ownRows = new Set(nativeRows.map(({ row }) => row));
    const descriptors = [
      ...nativeRows.map(({ row }) => ({ ...threadDescriptorForRow(row), migrationTarget: true })),
      ...threadRowsAnywhere()
        .filter((row) => !ownRows.has(row))
        .map((row) => ({ ...threadDescriptorForRow(row), migrationTarget: false })),
    ].filter((descriptor) => descriptor.id && descriptor.title);
    const renderedIds = new Set(descriptors.map(({ id }) => id));
    const hasMissingStableMembership = Object.keys(projectConfig(projectId).membership).some(
      (threadId) => !model.isTransientThreadId(threadId) && !renderedIds.has(threadId),
    );
    const allowMigration = !hasMissingStableMembership
      && list?.getAttribute("data-app-action-sidebar-project-show-all") === "true";
    const result = model.syncThreadIdentities(state, projectId, descriptors, allowMigration);
    if (!result.changed) return result;
    rekeyPendingMembershipChecks(projectId, result.migrations);
    saveState(result.state);
    return result;
  }

  function setAttribute(node, name, value) {
    const normalized = String(value);
    if (node.getAttribute(name) !== normalized) node.setAttribute(name, normalized);
  }

  function setText(node, value) {
    const normalized = String(value);
    if (node.textContent !== normalized) node.textContent = normalized;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .csg-group-item { position: relative; }
      .csg-group-row { padding-inline: 8px 5px; user-select: none; }
      .csg-group-leading { display: flex; min-width: 0; flex: 1; align-items: center; gap: 2px; }
      .csg-chevron, .csg-folder { display: flex; width: 16px; height: 16px; flex: 0 0 16px; align-items: center; justify-content: center; }
      .csg-chevron { color: var(--token-description-foreground, currentColor); transition: transform 120ms ease; }
      .csg-group-row[aria-expanded="true"] .csg-chevron { transform: rotate(90deg); }
      .csg-chevron svg, .csg-folder svg { width: 16px; height: 16px; }
      .csg-group-name-wrap { display: flex; min-width: 0; flex: 1; align-items: center; gap: 5px; margin-inline-start: 3px; }
      .csg-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .csg-group-count { flex: 0 0 auto; color: var(--token-description-foreground, currentColor); font-size: 11px; opacity: .68; }
      .csg-group-menu-button { display: flex; width: 24px; height: 24px; flex: 0 0 24px; align-items: center; justify-content: center; border: 0; border-radius: 7px; background: transparent; color: var(--token-description-foreground, currentColor); opacity: 0; cursor: pointer; }
      .csg-group-menu-button svg { width: 18px; height: 18px; }
      .csg-group-row:hover .csg-group-menu-button, .csg-group-row:focus-within .csg-group-menu-button { opacity: 1; }
      .csg-group-menu-button:hover, .csg-group-menu-button:focus-visible { color: var(--token-foreground, currentColor); background: var(--token-list-hover-background, rgba(0,0,0,.06)); outline: none; }
      .csg-group-row[data-csg-drop-active="true"], ${PROJECT_ROW_SELECTOR}[data-csg-drop-active="true"], ${THREAD_ROW_SELECTOR}[data-csg-drop-active="true"] { background: var(--token-list-hover-background, rgba(0,0,0,.08)) !important; outline: 1px solid var(--token-focus-border, currentColor); outline-offset: -1px; }
      [data-csg-hidden="true"] { display: none !important; }
      ${THREAD_ROW_SELECTOR}.csg-grouped-thread { padding-inline-start: calc(var(--padding-row-cell-x, var(--padding-row-x, 8px)) + 22px) !important; }
      ${THREAD_ROW_SELECTOR}.csg-thread-row { overflow: visible; }
      .csg-drag-handle { position: absolute; z-index: 12; inset-inline-start: 8px; top: 7px; display: flex; width: 16px; height: 16px; align-items: center; justify-content: center; color: var(--token-description-foreground, currentColor); opacity: 0; cursor: grab; }
      .csg-drag-handle:active { cursor: grabbing; }
      .csg-drag-handle svg { width: 12px; height: 16px; }
      ${THREAD_ROW_SELECTOR}.csg-grouped-thread .csg-drag-handle { inset-inline-start: 30px; }
      ${THREAD_ROW_SELECTOR}.csg-thread-row:hover .csg-drag-handle, .csg-drag-handle:focus-visible { opacity: .72; }
      ${THREAD_ROW_SELECTOR}.csg-dragging { opacity: .5; }
      .csg-name-input { min-width: 0; width: 100%; height: 23px; padding: 0 5px; border: 1px solid var(--token-focus-border, currentColor); border-radius: 6px; outline: none; background: var(--token-main-surface-primary, transparent); color: var(--token-foreground, currentColor); font: inherit; font-size: 13px; }
      .csg-menu { position: fixed; z-index: 2147483000; display: flex; min-width: 180px; flex-direction: column; padding: 4px; border: .5px solid var(--token-border, rgba(0,0,0,.12)); border-radius: 12px; background: color-mix(in srgb, var(--token-dropdown-background, white) 92%, transparent); color: var(--token-foreground, currentColor); box-shadow: 0 14px 35px rgba(0,0,0,.18); backdrop-filter: blur(12px); }
      .csg-menu-item { display: flex; min-height: 28px; align-items: center; padding: 5px var(--padding-row-x, 8px); border-radius: 8px; font-size: 13px; cursor: pointer; outline: none; }
      .csg-menu-item:hover, .csg-menu-item:focus { background: var(--token-list-hover-background, rgba(0,0,0,.06)); }
      .csg-menu-item-danger { color: var(--token-error-foreground, #c23b3b); }
      .csg-toast { position: fixed; z-index: 2147483001; left: 16px; bottom: 20px; max-width: 280px; padding: 8px 11px; border: .5px solid var(--token-border, rgba(0,0,0,.12)); border-radius: 10px; background: var(--token-dropdown-background, white); color: var(--token-foreground, currentColor); box-shadow: 0 8px 24px rgba(0,0,0,.16); font-size: 12px; }
    `;
    document.head.appendChild(style);
  }

  function makeGroupItem(nativeProjectRow, projectId, groupId) {
    const wrapper = document.createElement("div");
    wrapper.className = "csg-group-item";
    wrapper.setAttribute("role", "listitem");
    wrapper.dataset.csgProjectId = projectId;
    wrapper.dataset.csgGroupId = groupId;

    const row = document.createElement("div");
    row.className = `${nativeProjectRow.className} csg-group-row`;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.dataset.csgProjectId = projectId;
    row.dataset.csgGroupId = groupId;
    row.innerHTML = `
      <div class="csg-group-leading">
        <span class="csg-chevron">${chevronIcon}</span>
        <span class="csg-folder">${folderIcon}</span>
        <span class="csg-group-name-wrap">
          <span class="csg-group-name"></span>
          <span class="csg-group-count"></span>
        </span>
      </div>
      <button class="csg-group-menu-button" type="button">${moreIcon}</button>`;
    wrapper.appendChild(row);
    return wrapper;
  }

  function summarizeVisibleGroupRows(config, nativeRows) {
    const ownIds = new Set(nativeRows.map(({ row }) => threadIdForRow(row)).filter(Boolean));
    const globalIds = new Set(threadRowsAnywhere().map(threadIdForRow).filter(Boolean));
    const groups = new Map();
    for (const group of config.groups) {
      const memberIds = Object.entries(config.membership)
        .filter(([, assignedGroupId]) => assignedGroupId === group.id)
        .map(([threadId]) => threadId);
      const visible = memberIds.filter((threadId) => ownIds.has(threadId)).length;
      const external = memberIds.filter((threadId) => !ownIds.has(threadId) && globalIds.has(threadId)).length;
      groups.set(group.id, { visible, external });
    }
    return { groups };
  }

  function renderGroup(nativeProjectRow, stack, projectId, group, groupIndex, availability) {
    let wrapper = Array.from(stack.children).find(
      (child) => child.dataset?.csgProjectId === projectId && child.dataset?.csgGroupId === group.id,
    );
    if (!wrapper) {
      wrapper = makeGroupItem(nativeProjectRow, projectId, group.id);
      stack.appendChild(wrapper);
    }

    const row = wrapper.querySelector(".csg-group-row");
    const desiredClasses = `${nativeProjectRow.className} csg-group-row`;
    if (row.className !== desiredClasses) row.className = desiredClasses;
    wrapper.style.order = String(groupIndex * 10_000);
    const summary = availability || { visible: 0, external: 0 };
    setAttribute(row, "aria-expanded", String(!group.collapsed));
    const countText = summary.visible > 0 ? String(summary.visible) : "";
    setAttribute(row, "aria-label", `${group.name}，当前可见 ${summary.visible} 个会话`);
    row.removeAttribute("data-csg-incomplete");
    if (summary.external > 0) {
      row.title = `${summary.external} 个分组会话位于项目列表外（可能已置顶）`;
    } else {
      row.title = group.collapsed ? "点击展开分组" : "点击收起分组";
    }
    const name = row.querySelector(".csg-group-name");
    const count = row.querySelector(".csg-group-count");
    const isEditing = editingGroup?.projectId === projectId && editingGroup?.groupId === group.id;
    const staleInput = !isEditing ? row.querySelector(".csg-name-input") : null;
    if (staleInput) staleInput.remove();
    if (!isEditing) {
      name.hidden = false;
      setText(name, group.name);
    }
    setText(count, countText);
    const menuButton = row.querySelector(".csg-group-menu-button");
    setAttribute(menuButton, "aria-label", `${group.name} 的分组操作`);
    menuButton.title = "分组操作";

    if (isEditing) renderNameEditor(row, group);
    return wrapper;
  }

  function ensureDragHandle(row, projectId, threadId) {
    let handle = row.querySelector(":scope > .csg-drag-handle");
    if (!handle) {
      handle = document.createElement("span");
      handle.className = "csg-drag-handle";
      handle.setAttribute("role", "button");
      handle.setAttribute("aria-label", "拖动会话到分组");
      handle.title = "拖到分组；拖到项目文件夹或未分组会话可移出";
      handle.draggable = true;
      handle.tabIndex = -1;
      handle.innerHTML = gripIcon;
      handle.addEventListener("pointerdown", (event) => event.stopPropagation());
      handle.addEventListener("mousedown", (event) => event.stopPropagation());
      handle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      row.appendChild(handle);
    }
    handle.dataset.csgProjectId = projectId;
    handle.dataset.csgThreadId = threadId;
    row.classList.add("csg-thread-row");
  }

  function restoreThreadRow(row, wrapper) {
    if (row) {
      row.classList.remove("csg-grouped-thread", "csg-thread-row", "csg-dragging");
      row.removeAttribute("data-csg-project-id");
      row.removeAttribute("data-csg-group-id");
      row.removeAttribute("data-csg-drop-active");
      row.removeAttribute("data-csg-managed-thread-row");
      row.querySelector(":scope > .csg-drag-handle")?.remove();
    }
    if (wrapper) {
      wrapper.removeAttribute("data-csg-hidden");
      wrapper.removeAttribute("data-csg-managed-thread-wrapper");
      if (originalOrders.has(wrapper)) wrapper.style.order = originalOrders.get(wrapper);
    }
  }

  function restoreManagedThreadRows(root = document) {
    const restoredRows = new Set();
    root.querySelectorAll?.(MANAGED_THREAD_WRAPPER_SELECTOR).forEach((wrapper) => {
      const row = wrapper.querySelector(MANAGED_THREAD_ROW_SELECTOR);
      if (row) restoredRows.add(row);
      restoreThreadRow(row, wrapper);
    });
    root.querySelectorAll?.(MANAGED_THREAD_ROW_SELECTOR).forEach((row) => {
      if (restoredRows.has(row)) return;
      restoreThreadRow(row, row.closest('[role="listitem"]'));
    });
  }

  function restoreOrphanedManagedThreadRows(root = document) {
    const restoredRows = new Set();
    root.querySelectorAll?.(MANAGED_THREAD_WRAPPER_SELECTOR).forEach((wrapper) => {
      const row = wrapper.querySelector(MANAGED_THREAD_ROW_SELECTOR);
      if (row?.matches(THREAD_ROW_SELECTOR)) return;
      if (row) restoredRows.add(row);
      orphanedManagedWrappers.add(wrapper);
      restoreThreadRow(row, wrapper);
    });
    root.querySelectorAll?.(MANAGED_THREAD_ROW_SELECTOR).forEach((row) => {
      if (restoredRows.has(row) || row.matches(THREAD_ROW_SELECTOR)) return;
      restoreThreadRow(row, row.closest('[role="listitem"]'));
    });
  }

  function renderProject(nativeProjectRow) {
    const projectId = projectIdForRow(nativeProjectRow);
    if (!projectId) return;
    let config = projectConfig(projectId);
    const list = projectList(projectId);
    const stack = listStack(list);

    if (!stack) return;
    const existingGroupItems = Array.from(stack.children).filter(
      (child) => child.dataset?.csgProjectId === projectId && child.dataset?.csgGroupId,
    );
    const validGroupIds = new Set(config.groups.map((group) => group.id));
    existingGroupItems.forEach((item) => {
      if (!validGroupIds.has(item.dataset.csgGroupId)) {
        item.remove();
      }
    });

    const nativeRows = Array.from(stack.querySelectorAll(THREAD_ROW_SELECTOR))
      .map((row) => ({ row, wrapper: directThreadWrapper(row, stack) }))
      .filter((entry) => entry.wrapper);

    const identitySync = syncProjectThreadIdentities(projectId, list, nativeRows);
    if (identitySync.changed) config = projectConfig(projectId);
    const availability = summarizeVisibleGroupRows(config, nativeRows);

    if (config.groups.length === 0) {
      Array.from(stack.querySelectorAll(":scope > .csg-group-item")).forEach((item) => item.remove());
      restoreManagedThreadRows(stack);
      nativeRows.forEach(({ row, wrapper }) => restoreThreadRow(row, wrapper));
      Array.from(stack.children).forEach((child) => {
        if (originalOrders.has(child)) child.style.order = originalOrders.get(child);
      });
      return;
    }

    config.groups.forEach((group, index) => {
      renderGroup(
        nativeProjectRow,
        stack,
        projectId,
        group,
        index,
        availability.groups.get(group.id),
      );
    });
    nativeRows.forEach(({ row, wrapper }, nativeIndex) => {
      if (!originalOrders.has(wrapper)) originalOrders.set(wrapper, wrapper.style.order || "");
      touchedOrderElements.add(wrapper);
      const threadId = threadIdForRow(row);
      const assignedGroupId = config.membership[threadId] || "";
      const groupIndex = config.groups.findIndex((group) => group.id === assignedGroupId);
      const assignedGroup = groupIndex >= 0 ? config.groups[groupIndex] : null;
      const orderBase = assignedGroup ? groupIndex * 10_000 + 100 : config.groups.length * 10_000 + 100;
      wrapper.dataset.csgManagedThreadWrapper = "true";
      row.dataset.csgManagedThreadRow = "true";
      wrapper.style.order = String(orderBase + nativeIndex);
      if (assignedGroup?.collapsed) wrapper.dataset.csgHidden = "true";
      else wrapper.removeAttribute("data-csg-hidden");
      row.classList.toggle("csg-grouped-thread", Boolean(assignedGroup));
      row.dataset.csgProjectId = projectId;
      if (assignedGroupId) row.dataset.csgGroupId = assignedGroupId;
      else row.removeAttribute("data-csg-group-id");
      ensureDragHandle(row, projectId, threadId);
    });

    Array.from(stack.children).forEach((child, index) => {
      if (child.matches?.(".csg-group-item") || child.querySelector?.(THREAD_ROW_SELECTOR)) return;
      if (orphanedManagedWrappers.has(child)) {
        if (originalOrders.has(child)) child.style.order = originalOrders.get(child);
        return;
      }
      if (!originalOrders.has(child)) originalOrders.set(child, child.style.order || "");
      touchedOrderElements.add(child);
      child.style.order = String(900_000 + index);
    });
  }

  function renderNameEditor(row, group) {
    if (row.querySelector(".csg-name-input")) return;
    const name = row.querySelector(".csg-group-name");
    if (!name) return;
    name.hidden = true;
    const input = document.createElement("input");
    input.className = "csg-name-input";
    input.value = group.name;
    input.maxLength = model.MAX_NAME_LENGTH;
    input.setAttribute("aria-label", "分组名称");
    name.after(input);
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finishNameEditor(input, false);
      else if (event.key === "Escape") finishNameEditor(input, true);
    });
    input.addEventListener("blur", () => finishNameEditor(input, false));
    queueMicrotask(() => {
      if (!input.isConnected) return;
      input.focus();
      input.select();
    });
  }

  function finishNameEditor(input, cancelled) {
    if (!editingGroup || input.dataset.csgFinished === "true") return;
    input.dataset.csgFinished = "true";
    const edit = editingGroup;
    editingGroup = null;
    const requested = input.value.trim();
    if (cancelled && edit.isNew) {
      saveState(model.deleteGroup(state, edit.projectId, edit.groupId).state);
    } else if (!cancelled && !requested && edit.isNew) {
      saveState(model.deleteGroup(state, edit.projectId, edit.groupId).state);
    } else if (!cancelled && requested) {
      saveState(model.renameGroup(state, edit.projectId, edit.groupId, requested).state);
    } else {
      scheduleRender();
    }
  }

  function beginRename(projectId, groupId, isNew = false) {
    if (!groupConfig(projectId, groupId)) return;
    closeGroupMenu();
    editingGroup = { projectId, groupId, isNew };
    scheduleRender();
  }

  function createGroup(projectId) {
    const result = model.createGroup(state, projectId, "新建分组");
    saveState(result.state);
    const row = projectRow(projectId);
    if (row?.getAttribute("data-app-action-sidebar-project-collapsed") === "true") row.click();
    beginRename(projectId, result.group.id, true);
    return result.group;
  }

  function deleteGroup(projectId, groupId) {
    const existing = groupConfig(projectId, groupId);
    if (!existing) return;
    closeGroupMenu();
    saveState(model.deleteGroup(state, projectId, groupId).state);
    showToast(`已删除“${existing.name}”；会话仍保留`);
  }

  function toggleGroup(projectId, groupId, forcedCollapsed) {
    const result = typeof forcedCollapsed === "boolean"
      ? model.setCollapsed(state, projectId, groupId, forcedCollapsed)
      : model.toggleGroup(state, projectId, groupId);
    saveState(result.state);
    return result.group;
  }

  function toggleGroupFromInteraction(projectId, groupId, forcedCollapsed) {
    return toggleGroup(projectId, groupId, forcedCollapsed);
  }

  function assignThread(projectId, threadId, groupId) {
    const previous = projectConfig(projectId).membership[threadId] || null;
    if ((groupId || null) === previous) return;
    const list = projectList(projectId);
    const row = Array.from(list?.querySelectorAll?.(THREAD_ROW_SELECTOR) || []).find(
      (candidate) => threadIdForRow(candidate) === threadId,
    ) || null;
    saveState(model.assignThread(state, projectId, threadId, groupId, threadDescriptorForRow(row)).state);
    const destination = groupId ? groupConfig(projectId, groupId)?.name : "";
    showToast(destination ? `已移入“${destination}”` : "已移出分组");
  }

  function clearMembershipCheck(projectId, threadId, reason = "") {
    const key = membershipKey(projectId, threadId);
    const pending = membershipChecks.get(key);
    if (!pending || (reason && pending.reason !== reason)) return;
    window.clearTimeout(pending.timer);
    membershipChecks.delete(key);
  }

  function rekeyPendingMembershipChecks(projectId, migrations) {
    for (const migration of migrations || []) {
      if (!migration?.fromThreadId || !migration?.toThreadId) continue;
      const oldKey = membershipKey(projectId, migration.fromThreadId);
      const pending = membershipChecks.get(oldKey);
      if (!pending || pending.projectId !== projectId) continue;
      const newKey = membershipKey(projectId, migration.toThreadId);
      const conflicting = membershipChecks.get(newKey);
      if (conflicting && conflicting !== pending) {
        window.clearTimeout(conflicting.timer);
        membershipChecks.delete(newKey);
      }
      membershipChecks.delete(oldKey);
      pending.threadId = migration.toThreadId;
      if (pending.observedThreadId === migration.fromThreadId) {
        pending.observedThreadId = migration.toThreadId;
      }
      pending.key = newKey;
      membershipChecks.set(newKey, pending);
    }
  }

  function removeVisualMembership(projectId, threadId, expectedGroupId) {
    if (projectConfig(projectId).membership[threadId] !== expectedGroupId) return false;
    const result = model.unassignThreads(state, projectId, [threadId]);
    if (result.threadIds.length === 0) return false;
    saveState(result.state);
    scheduleRender();
    return true;
  }

  function scheduleArchiveReconciliation(projectId, threadId, groupId, observedThreadId = threadId) {
    clearMembershipCheck(projectId, threadId);
    const key = membershipKey(projectId, threadId);
    const pending = {
      reason: "archive",
      projectId,
      threadId,
      observedThreadId,
      groupId,
      attempts: 0,
      key,
      timer: 0,
    };

    const verify = () => {
      if (membershipChecks.get(pending.key) !== pending || pending.reason !== "archive") return;
      membershipChecks.delete(pending.key);
      if (projectConfig(projectId).membership[pending.threadId] !== pending.groupId) return;
      if (!threadExistsAnywhere(pending.observedThreadId)) {
        removeVisualMembership(projectId, pending.threadId, pending.groupId);
        return;
      }
      pending.attempts += 1;
      if (pending.attempts >= 5) return;
      pending.timer = window.setTimeout(verify, 300 + pending.attempts * 250);
      membershipChecks.set(pending.key, pending);
    };

    pending.timer = window.setTimeout(verify, 350);
    membershipChecks.set(key, pending);
  }

  function scheduleRender() {
    if (destroyed || renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  }

  function pruneRuntimeTrackers() {
    restoreOrphanedManagedThreadRows(document);
    touchedOrderElements.forEach((element) => {
      if (!element?.isConnected) touchedOrderElements.delete(element);
    });
  }

  function render() {
    if (destroyed || rendering) return;
    rendering = true;
    try {
      pruneRuntimeTrackers();
      injectStyles();
      projectRows().forEach(renderProject);
      injectProjectMenuItems();
    } catch (error) {
      console.warn("[session-groups] Render failed", error);
    } finally {
      rendering = false;
    }
  }

  function nativeProjectMenuTrigger(row) {
    return Array.from(row?.querySelectorAll?.('[aria-haspopup="menu"]') || []).find(
      (candidate) => candidate.hasAttribute("aria-controls") || candidate.getAttribute("data-state") === "open",
    ) || Array.from(row?.querySelectorAll?.('[aria-haspopup="menu"]') || [])[0]
      || null;
  }

  function openNativeProjectMenu(row) {
    const trigger = nativeProjectMenuTrigger(row);
    if (!trigger) return;
    activeProjectMenuId = projectIdForRow(row);
    if (trigger.getAttribute("data-state") === "open" || trigger.getAttribute("aria-expanded") === "true") {
      scheduleRender();
      return;
    }
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      trigger.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type.includes("down") ? 1 : 0,
        view: window,
      }));
    }
    setTimeout(scheduleRender, 0);
  }

  function closeNativeProjectMenu(projectId) {
    const row = projectRow(projectId);
    const trigger = nativeProjectMenuTrigger(row);
    if (!trigger || (trigger.getAttribute("data-state") !== "open" && trigger.getAttribute("aria-expanded") !== "true")) return;
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  }

  function elementClassName(element, fallback) {
    return element?.getAttribute?.("class")?.trim() || fallback;
  }

  function nativeMenuContentClasses(template) {
    const firstChild = template?.firstElementChild;
    const content = firstChild?.tagName?.toLowerCase() === "div" ? firstChild : null;
    const directChildren = Array.from(content?.children || []);
    const icon = directChildren.find((child) => child.tagName?.toLowerCase() === "svg");
    const label = directChildren.find((child) => child.tagName?.toLowerCase() === "span");
    return {
      content: elementClassName(content, CREATE_GROUP_CONTENT_CLASS),
      icon: elementClassName(icon, CREATE_GROUP_ICON_CLASS),
      label: elementClassName(label, CREATE_GROUP_LABEL_CLASS),
    };
  }

  function createFolderPlusIcon(className) {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    const attributes = {
      width: "20",
      height: "20",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
      class: className,
    };
    Object.entries(attributes).forEach(([name, value]) => icon.setAttribute(name, value));
    for (const pathData of [
      "M12 10v6",
      "M9 13h6",
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ]) {
      const path = document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", pathData);
      icon.appendChild(path);
    }
    return icon;
  }

  function createGroupMenuContent(template) {
    const classes = nativeMenuContentClasses(template);
    const content = document.createElement("div");
    content.className = classes.content;
    content.appendChild(createFolderPlusIcon(classes.icon));
    const label = document.createElement("span");
    label.className = classes.label;
    label.textContent = "新建分组";
    content.appendChild(label);
    return content;
  }

  function injectProjectMenuItems() {
    for (const row of projectRows()) {
      const trigger = nativeProjectMenuTrigger(row);
      if (!trigger || (trigger.getAttribute("data-state") !== "open" && trigger.getAttribute("aria-expanded") !== "true")) continue;
      const projectId = projectIdForRow(row);
      activeProjectMenuId = projectId;
      const menuId = trigger.getAttribute("aria-controls")
        || row.querySelector('[aria-haspopup="menu"][aria-controls]')?.getAttribute("aria-controls");
      const menu = menuId ? document.getElementById(menuId) : null;
      if (!menu?.matches?.('[role="menu"]')) continue;
      let item = menu.querySelector('[data-csg-create-group="true"]');
      if (!item) {
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        const editItem = items.find((candidate) => /编辑项目|edit project/i.test(candidate.textContent || ""));
        const template = editItem || items[0] || null;
        item = document.createElement("div");
        item.dataset.csgCreateGroup = "true";
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-radix-collection-item", "");
        item.tabIndex = -1;
        item.className = template?.className || "csg-menu-item";
        item.appendChild(createGroupMenuContent(template));
        if (editItem?.nextSibling) menu.insertBefore(item, editItem.nextSibling);
        else menu.appendChild(item);
      }
      if (item.dataset.csgProjectId !== projectId) item.dataset.csgProjectId = projectId;
    }
  }

  function showGroupMenu(projectId, groupId, x, y) {
    const group = groupConfig(projectId, groupId);
    if (!group) return;
    closeGroupMenu();
    const menu = document.createElement("div");
    menu.className = "csg-menu";
    menu.setAttribute("role", "menu");
    menu.dataset.csgProjectId = projectId;
    menu.dataset.csgGroupId = groupId;
    menu.innerHTML = `
      <div class="csg-menu-item" role="menuitem" tabindex="0" data-csg-action="rename">重命名分组</div>
      <div class="csg-menu-item csg-menu-item-danger" role="menuitem" tabindex="0" data-csg-action="delete">删除分组（保留会话）</div>`;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    groupMenu = menu;
    menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }

  function closeGroupMenu() {
    groupMenu?.remove();
    groupMenu = null;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    document.querySelector(".csg-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "csg-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    toastTimer = window.setTimeout(() => toast.remove(), 2_200);
  }

  function setDropTarget(node) {
    if (dropTarget === node) return;
    dropTarget?.removeAttribute?.("data-csg-drop-active");
    dropTarget = node;
    dropTarget?.setAttribute?.("data-csg-drop-active", "true");
  }

  function dropDestination(target) {
    if (!dragSession) return null;
    const groupRow = target.closest?.(".csg-group-row");
    if (groupRow && groupRow.dataset.csgProjectId === dragSession.projectId) {
      return { node: groupRow, groupId: groupRow.dataset.csgGroupId };
    }
    const targetThread = target.closest?.(THREAD_ROW_SELECTOR);
    if (targetThread) {
      const list = targetThread.closest(PROJECT_LIST_SELECTOR);
      const projectId = list?.getAttribute("data-app-action-sidebar-project-list-id") || "";
      if (projectId === dragSession.projectId) {
        const targetThreadId = threadIdForRow(targetThread);
        const groupId = projectConfig(projectId).membership[targetThreadId] || null;
        return { node: targetThread, groupId };
      }
    }
    const targetProject = target.closest?.(PROJECT_ROW_SELECTOR);
    if (targetProject && projectIdForRow(targetProject) === dragSession.projectId) {
      return { node: targetProject, groupId: null };
    }
    const list = target.closest?.(PROJECT_LIST_SELECTOR);
    if (list?.getAttribute("data-app-action-sidebar-project-list-id") === dragSession.projectId) {
      return { node: list, groupId: null };
    }
    return null;
  }

  function clearDrag() {
    document.querySelector(`${THREAD_ROW_SELECTOR}.csg-dragging`)?.classList.remove("csg-dragging");
    dragSession = null;
    setDropTarget(null);
  }

  function onPointerDown(event) {
    const projectAction = event.target.closest?.(`${PROJECT_ROW_SELECTOR} [aria-haspopup="menu"]`);
    if (projectAction) {
      activeProjectMenuId = projectIdForRow(projectAction.closest(PROJECT_ROW_SELECTOR));
      setTimeout(scheduleRender, 0);
    }
    if (groupMenu && !event.target.closest?.(".csg-menu") && !event.target.closest?.(".csg-group-menu-button")) {
      closeGroupMenu();
    }
    if (event.target.closest?.('[data-csg-create-group="true"]')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onContextMenu(event) {
    const groupRow = event.target.closest?.(".csg-group-row");
    if (groupRow) {
      event.preventDefault();
      event.stopPropagation();
      showGroupMenu(groupRow.dataset.csgProjectId, groupRow.dataset.csgGroupId, event.clientX, event.clientY);
      return;
    }
    const row = event.target.closest?.(PROJECT_ROW_SELECTOR);
    if (row && nativeProjectMenuTrigger(row)) {
      event.preventDefault();
      event.stopPropagation();
      openNativeProjectMenu(row);
    }
  }

  function onClick(event) {
    const archiveButton = event.target.closest?.("button[aria-label]");
    if (archiveButton && ARCHIVE_LABEL_PATTERN.test(archiveButton.getAttribute("aria-label")?.trim() || "")) {
      const threadRow = archiveButton.closest(THREAD_ROW_SELECTOR);
      const threadId = threadIdForRow(threadRow);
      const preferredProjectId = threadRow?.closest(PROJECT_LIST_SELECTOR)
        ?.getAttribute("data-app-action-sidebar-project-list-id") || threadRow?.dataset.csgProjectId || "";
      const context = membershipContext(threadId, preferredProjectId)
        || transientAliasContextForRow(threadRow, preferredProjectId);
      if (context) {
        scheduleArchiveReconciliation(context.projectId, context.threadId, context.groupId, threadId);
      } else {
        blockFingerprintMigrationSources(threadRow, preferredProjectId);
      }
    }

    const createItem = event.target.closest?.('[data-csg-create-group="true"]');
    if (createItem) {
      event.preventDefault();
      event.stopPropagation();
      const projectId = createItem.dataset.csgProjectId || activeProjectMenuId;
      closeNativeProjectMenu(projectId);
      createGroup(projectId);
      return;
    }

    const menuAction = event.target.closest?.(".csg-menu-item[data-csg-action]");
    if (menuAction && groupMenu) {
      event.preventDefault();
      event.stopPropagation();
      const { csgProjectId: projectId, csgGroupId: groupId } = groupMenu.dataset;
      if (menuAction.dataset.csgAction === "rename") beginRename(projectId, groupId);
      else if (menuAction.dataset.csgAction === "delete") deleteGroup(projectId, groupId);
      return;
    }

    const menuButton = event.target.closest?.(".csg-group-menu-button");
    if (menuButton) {
      event.preventDefault();
      event.stopPropagation();
      const row = menuButton.closest(".csg-group-row");
      const rect = menuButton.getBoundingClientRect();
      showGroupMenu(row.dataset.csgProjectId, row.dataset.csgGroupId, rect.right, rect.bottom + 3);
      return;
    }

    const groupRow = event.target.closest?.(".csg-group-row");
    if (groupRow && !event.target.closest("input")) {
      event.preventDefault();
      event.stopPropagation();
      toggleGroupFromInteraction(groupRow.dataset.csgProjectId, groupRow.dataset.csgGroupId);
    }
  }

  function onDoubleClick(event) {
    const name = event.target.closest?.(".csg-group-name");
    if (!name) return;
    const row = name.closest(".csg-group-row");
    event.preventDefault();
    event.stopPropagation();
    beginRename(row.dataset.csgProjectId, row.dataset.csgGroupId);
  }

  function onKeyDown(event) {
    if (groupMenu && event.target.closest?.(".csg-menu")) {
      const items = Array.from(groupMenu.querySelectorAll('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(index + delta + items.length) % items.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeGroupMenu();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        document.activeElement?.click?.();
      }
      return;
    }

    const row = event.target.closest?.(".csg-group-row");
    if (!row || event.target.closest("input,button")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleGroupFromInteraction(row.dataset.csgProjectId, row.dataset.csgGroupId);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      toggleGroupFromInteraction(row.dataset.csgProjectId, row.dataset.csgGroupId, false);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      toggleGroupFromInteraction(row.dataset.csgProjectId, row.dataset.csgGroupId, true);
    } else if (event.key === "F2") {
      event.preventDefault();
      beginRename(row.dataset.csgProjectId, row.dataset.csgGroupId);
    }
  }

  function onDragStart(event) {
    const handle = event.target.closest?.(".csg-drag-handle");
    if (!handle) return;
    const row = handle.closest(THREAD_ROW_SELECTOR);
    const projectId = handle.dataset.csgProjectId;
    const threadId = handle.dataset.csgThreadId;
    if (!row || !projectId || !threadId) return;
    dragSession = { projectId, threadId };
    row.classList.add("csg-dragging");
    event.dataTransfer?.setData("application/x-codex-session-group-thread", JSON.stringify(dragSession));
    event.dataTransfer?.setData("text/plain", threadId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    event.stopPropagation();
  }

  function onDragOver(event) {
    const destination = dropDestination(event.target);
    if (!destination) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(destination.node);
  }

  function onDrop(event) {
    const destination = dropDestination(event.target);
    if (!destination || !dragSession) return;
    event.preventDefault();
    event.stopPropagation();
    const { projectId, threadId } = dragSession;
    assignThread(projectId, threadId, destination.groupId);
    clearDrag();
  }

  function onStorage(event) {
    if (event.key !== STORAGE_KEY) return;
    state = loadState();
    scheduleRender();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    observer = null;
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    closeGroupMenu();
    clearDrag();
    window.clearTimeout(toastTimer);
    membershipChecks.forEach(({ timer }) => window.clearTimeout(timer));
    membershipChecks.clear();
    document.querySelector(".csg-toast")?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll(".csg-group-item").forEach((item) => item.remove());
    restoreManagedThreadRows(document);
    document.querySelectorAll(THREAD_ROW_SELECTOR).forEach((row) => {
      restoreThreadRow(row, row.closest('[role="listitem"]'));
    });
    document.querySelectorAll('[data-csg-create-group="true"]').forEach((item) => item.remove());
    document.querySelectorAll('[data-csg-drop-active="true"]').forEach((node) => node.removeAttribute("data-csg-drop-active"));
    touchedOrderElements.forEach((element) => {
      if (element?.isConnected && originalOrders.has(element)) element.style.order = originalOrders.get(element);
    });
    touchedOrderElements.clear();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDoubleClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("dragend", clearDrag, true);
    document.removeEventListener("scroll", closeGroupMenu, true);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("blur", closeGroupMenu);
    window.removeEventListener("resize", closeGroupMenu);
    delete globalThis[GLOBAL_KEY];
  }

  injectStyles();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("dragend", clearDrag, true);
  document.addEventListener("scroll", closeGroupMenu, true);
  window.addEventListener("storage", onStorage);
  window.addEventListener("blur", closeGroupMenu);
  window.addEventListener("resize", closeGroupMenu);
  observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "aria-controls",
      "aria-disabled",
      "aria-expanded",
      "aria-hidden",
      "disabled",
      "hidden",
      "data-state",
      "data-app-action-sidebar-project-collapsed",
      "data-app-action-sidebar-project-show-all",
      "data-app-action-sidebar-thread-id",
      "data-app-action-sidebar-thread-title",
    ],
  });

  globalThis[GLOBAL_KEY] = Object.freeze({
    version: VERSION,
    storageKey: STORAGE_KEY,
    getState: cloneState,
    replaceState: (nextState) => saveState(nextState),
    createGroup,
    renameGroup: (projectId, groupId, name) => {
      const result = model.renameGroup(state, projectId, groupId, name);
      saveState(result.state);
      return result.group;
    },
    deleteGroup,
    assignThread,
    toggleGroup,
    getDiagnostics: () => ({
      membershipChecks: membershipChecks.size,
      touchedOrderElements: touchedOrderElements.size,
    }),
    refresh: render,
    destroy,
  });
  render();
})();

//# sourceURL=codex-session-groups-ui.js
