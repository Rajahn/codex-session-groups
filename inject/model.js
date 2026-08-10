(() => {
  "use strict";

  const GLOBAL_KEY = "__CODEX_SESSION_GROUPS_MODEL_V1__";
  const IMPLEMENTATION_VERSION = "0.1.2";
  const VERSION = 1;
  const MAX_NAME_LENGTH = 60;
  const MAX_THREAD_TITLE_LENGTH = 500;

  if (globalThis[GLOBAL_KEY]?.IMPLEMENTATION_VERSION === IMPLEMENTATION_VERSION) return;

  function emptyState() {
    return { version: VERSION, projects: {} };
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function groupName(value) {
    return text(value).replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  }

  function threadHint(value) {
    if (!value || typeof value !== "object") return null;
    const title = text(value.title).slice(0, MAX_THREAD_TITLE_LENGTH);
    if (!title) return null;
    const hostId = text(value.hostId).slice(0, 100);
    const kind = text(value.kind).slice(0, 100);
    return { title, hostId, kind };
  }

  function sameThreadHint(left, right) {
    return Boolean(left && right
      && left.title === right.title
      && left.hostId === right.hostId
      && left.kind === right.kind);
  }

  function matchingThreadHint(saved, candidate) {
    if (!saved || !candidate || saved.title !== candidate.title) return false;
    if (saved.hostId && saved.hostId !== candidate.hostId) return false;
    if (saved.kind && saved.kind !== candidate.kind) return false;
    return true;
  }

  function isTransientThreadId(value) {
    return text(value).includes(":client-new-thread:");
  }

  function makeId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeState(input) {
    const next = emptyState();
    if (!input || typeof input !== "object" || !input.projects || typeof input.projects !== "object") {
      return next;
    }

    for (const [rawProjectId, rawProject] of Object.entries(input.projects)) {
      const projectId = text(rawProjectId);
      if (!projectId || !rawProject || typeof rawProject !== "object") continue;

      const groups = [];
      const knownIds = new Set();
      for (const rawGroup of Array.isArray(rawProject.groups) ? rawProject.groups : []) {
        const id = text(rawGroup?.id);
        const name = groupName(rawGroup?.name);
        if (!id || !name || knownIds.has(id)) continue;
        knownIds.add(id);
        groups.push({
          id,
          name,
          collapsed: Boolean(rawGroup?.collapsed),
          createdAt: Number.isFinite(rawGroup?.createdAt) ? rawGroup.createdAt : 0,
          updatedAt: Number.isFinite(rawGroup?.updatedAt) ? rawGroup.updatedAt : 0,
        });
      }

      const membership = {};
      if (rawProject.membership && typeof rawProject.membership === "object") {
        for (const [rawThreadId, rawGroupId] of Object.entries(rawProject.membership)) {
          const threadId = text(rawThreadId);
          const targetGroupId = text(rawGroupId);
          if (threadId && knownIds.has(targetGroupId)) membership[threadId] = targetGroupId;
        }
      }

      const threadHints = {};
      if (rawProject.threadHints && typeof rawProject.threadHints === "object") {
        for (const [rawThreadId, rawHint] of Object.entries(rawProject.threadHints)) {
          const threadId = text(rawThreadId);
          const hint = threadHint(rawHint);
          if (threadId && membership[threadId] && hint) threadHints[threadId] = hint;
        }
      }

      if (groups.length > 0 || Object.keys(membership).length > 0) {
        next.projects[projectId] = { groups, membership, threadHints };
      }
    }
    return next;
  }

  function projectCopy(state, projectId) {
    const normalized = normalizeState(state);
    const id = text(projectId);
    if (!id) throw new Error("projectId is required");
    normalized.projects[id] ||= { groups: [], membership: {}, threadHints: {} };
    return { state: normalized, project: normalized.projects[id], projectId: id };
  }

  function uniqueName(project, requested, exceptGroupId = "") {
    const base = groupName(requested) || "新建分组";
    const used = new Set(
      project.groups
        .filter((group) => group.id !== exceptGroupId)
        .map((group) => group.name.toLocaleLowerCase()),
    );
    if (!used.has(base.toLocaleLowerCase())) return base;
    for (let index = 2; index < 10_000; index += 1) {
      const suffix = ` ${index}`;
      const candidate = `${base.slice(0, Math.max(1, MAX_NAME_LENGTH - suffix.length))}${suffix}`;
      if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return `${base.slice(0, MAX_NAME_LENGTH - 8)} ${Date.now().toString(36).slice(-6)}`;
  }

  function createGroup(state, projectId, requestedName = "新建分组", requestedId = "") {
    const copy = projectCopy(state, projectId);
    const now = Date.now();
    let id = text(requestedId) || makeId();
    while (copy.project.groups.some((group) => group.id === id)) id = makeId();
    const group = {
      id,
      name: uniqueName(copy.project, requestedName),
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    copy.project.groups.push(group);
    return { state: copy.state, group: { ...group } };
  }

  function renameGroup(state, projectId, groupId, requestedName) {
    const copy = projectCopy(state, projectId);
    const id = text(groupId);
    const group = copy.project.groups.find((candidate) => candidate.id === id);
    if (!group) return { state: copy.state, group: null };
    group.name = uniqueName(copy.project, requestedName || group.name, id);
    group.updatedAt = Date.now();
    return { state: copy.state, group: { ...group } };
  }

  function setCollapsed(state, projectId, groupId, collapsed) {
    const copy = projectCopy(state, projectId);
    const group = copy.project.groups.find((candidate) => candidate.id === text(groupId));
    if (!group) return { state: copy.state, group: null };
    group.collapsed = Boolean(collapsed);
    group.updatedAt = Date.now();
    return { state: copy.state, group: { ...group } };
  }

  function toggleGroup(state, projectId, groupId) {
    const normalized = normalizeState(state);
    const group = normalized.projects[text(projectId)]?.groups.find(
      (candidate) => candidate.id === text(groupId),
    );
    return setCollapsed(normalized, projectId, groupId, !group?.collapsed);
  }

  function assignThread(state, projectId, threadId, groupId = null, hintValue = null) {
    const copy = projectCopy(state, projectId);
    const taskId = text(threadId);
    if (!taskId) throw new Error("threadId is required");
    const targetGroupId = text(groupId);
    if (!targetGroupId) {
      delete copy.project.membership[taskId];
      delete copy.project.threadHints[taskId];
      return { state: copy.state, groupId: null };
    }
    if (!copy.project.groups.some((group) => group.id === targetGroupId)) {
      throw new Error(`Unknown group: ${targetGroupId}`);
    }
    copy.project.membership[taskId] = targetGroupId;
    const hint = threadHint(hintValue);
    if (hint) copy.project.threadHints[taskId] = hint;
    return { state: copy.state, groupId: targetGroupId };
  }

  function unassignThreads(state, projectId, threadIds) {
    const normalized = normalizeState(state);
    const id = text(projectId);
    const project = normalized.projects[id];
    if (!project) return { state: normalized, threadIds: [] };

    const requested = new Set(
      Array.from(threadIds || [], (threadId) => text(threadId)).filter(Boolean),
    );
    const removed = [];
    for (const threadId of requested) {
      if (!Object.hasOwn(project.membership, threadId)) continue;
      delete project.membership[threadId];
      delete project.threadHints[threadId];
      removed.push(threadId);
    }
    if (project.groups.length === 0 && Object.keys(project.membership).length === 0) {
      delete normalized.projects[id];
    }
    return { state: normalized, threadIds: removed };
  }

  function syncThreadIdentities(state, projectId, renderedThreads, allowMigration = false) {
    const copy = projectCopy(state, projectId);
    const descriptors = [];
    const seenIds = new Set();
    for (const rawDescriptor of Array.isArray(renderedThreads) ? renderedThreads : []) {
      const id = text(rawDescriptor?.id);
      const hint = threadHint(rawDescriptor);
      if (!id || !hint || seenIds.has(id)) continue;
      seenIds.add(id);
      descriptors.push({ id, hint });
    }

    let changed = false;
    const migrations = [];
    const renderedIds = new Set(descriptors.map((descriptor) => descriptor.id));
    if (allowMigration) {
      const staleEntries = Object.entries(copy.project.membership).filter(([threadId]) => (
        isTransientThreadId(threadId)
        && !renderedIds.has(threadId)
        && copy.project.threadHints[threadId]
      ));
      for (const [oldThreadId, groupId] of staleEntries) {
        const savedHint = copy.project.threadHints[oldThreadId];
        const sameSourceHints = staleEntries.filter(([candidateId]) => (
          sameThreadHint(copy.project.threadHints[candidateId], savedHint)
        ));
        if (sameSourceHints.length !== 1) continue;

        const candidates = descriptors.filter(({ id, hint }) => (
          id !== oldThreadId
          && !isTransientThreadId(id)
          && !copy.project.membership[id]
          && matchingThreadHint(savedHint, hint)
        ));
        if (candidates.length !== 1) continue;

        const target = candidates[0];
        delete copy.project.membership[oldThreadId];
        delete copy.project.threadHints[oldThreadId];
        copy.project.membership[target.id] = groupId;
        copy.project.threadHints[target.id] = target.hint;
        migrations.push({ fromThreadId: oldThreadId, toThreadId: target.id, groupId });
        changed = true;
      }
    }

    for (const { id, hint } of descriptors) {
      if (!copy.project.membership[id]) continue;
      if (sameThreadHint(copy.project.threadHints[id], hint)) continue;
      copy.project.threadHints[id] = hint;
      changed = true;
    }
    return { state: copy.state, changed, migrations };
  }

  function deleteGroup(state, projectId, groupId) {
    const copy = projectCopy(state, projectId);
    const id = text(groupId);
    const deleted = copy.project.groups.find((group) => group.id === id) || null;
    copy.project.groups = copy.project.groups.filter((group) => group.id !== id);
    for (const [threadId, assignedGroupId] of Object.entries(copy.project.membership)) {
      if (assignedGroupId !== id) continue;
      delete copy.project.membership[threadId];
      delete copy.project.threadHints[threadId];
    }
    if (copy.project.groups.length === 0 && Object.keys(copy.project.membership).length === 0) {
      delete copy.state.projects[copy.projectId];
    }
    return { state: copy.state, group: deleted ? { ...deleted } : null };
  }

  globalThis[GLOBAL_KEY] = Object.freeze({
    IMPLEMENTATION_VERSION,
    VERSION,
    MAX_NAME_LENGTH,
    MAX_THREAD_TITLE_LENGTH,
    emptyState,
    normalizeState,
    createGroup,
    renameGroup,
    setCollapsed,
    toggleGroup,
    assignThread,
    unassignThreads,
    syncThreadIdentities,
    deleteGroup,
    isTransientThreadId,
    uniqueName,
  });
})();

//# sourceURL=codex-session-groups-model.js
