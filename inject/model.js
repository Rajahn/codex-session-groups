(() => {
  "use strict";

  const GLOBAL_KEY = "__CODEX_SESSION_GROUPS_MODEL_V1__";
  const IMPLEMENTATION_VERSION = "0.1.7";
  const VERSION = 1;
  const MAX_NAME_LENGTH = 60;
  const MAX_THREAD_TITLE_LENGTH = 500;
  const MAX_MIGRATION_BLOCK_REASON_LENGTH = 120;

  if (globalThis[GLOBAL_KEY]?.IMPLEMENTATION_VERSION === IMPLEMENTATION_VERSION
    && typeof globalThis[GLOBAL_KEY]?.blockThreadMigrations === "function") return;

  function dictionary() {
    return Object.create(null);
  }

  function emptyState() {
    return { version: VERSION, projects: dictionary() };
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

  function migrationBlockReason(value) {
    return text(value).replace(/\s+/g, " ").slice(0, MAX_MIGRATION_BLOCK_REASON_LENGTH);
  }

  function migrationBlock(value) {
    if (!value || typeof value !== "object") return null;
    const reason = migrationBlockReason(value.reason);
    if (!reason) return null;
    const createdAt = Number.isFinite(value.createdAt) && value.createdAt >= 0 ? value.createdAt : 0;
    return { reason, createdAt };
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

      const membership = dictionary();
      if (rawProject.membership && typeof rawProject.membership === "object") {
        for (const [rawThreadId, rawGroupId] of Object.entries(rawProject.membership)) {
          const threadId = text(rawThreadId);
          const targetGroupId = text(rawGroupId);
          if (threadId && knownIds.has(targetGroupId)) membership[threadId] = targetGroupId;
        }
      }

      const threadHints = dictionary();
      if (rawProject.threadHints && typeof rawProject.threadHints === "object") {
        for (const [rawThreadId, rawHint] of Object.entries(rawProject.threadHints)) {
          const threadId = text(rawThreadId);
          const hint = threadHint(rawHint);
          if (threadId && membership[threadId] && hint) threadHints[threadId] = hint;
        }
      }

      const migrationBlocks = dictionary();
      if (rawProject.migrationBlocks && typeof rawProject.migrationBlocks === "object") {
        for (const [rawThreadId, rawBlock] of Object.entries(rawProject.migrationBlocks)) {
          const threadId = text(rawThreadId);
          const block = migrationBlock(rawBlock);
          if (threadId
            && Object.hasOwn(membership, threadId)
            && isTransientThreadId(threadId)
            && block) {
            migrationBlocks[threadId] = block;
          }
        }
      }

      if (groups.length > 0 || Object.keys(membership).length > 0) {
        next.projects[projectId] = { groups, membership, threadHints, migrationBlocks };
      }
    }
    return next;
  }

  function projectCopy(state, projectId) {
    const normalized = normalizeState(state);
    const id = text(projectId);
    if (!id) throw new Error("projectId is required");
    if (!Object.hasOwn(normalized.projects, id)) {
      normalized.projects[id] = {
        groups: [],
        membership: dictionary(),
        threadHints: dictionary(),
        migrationBlocks: dictionary(),
      };
    }
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
      delete copy.project.migrationBlocks[taskId];
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
      delete project.migrationBlocks[threadId];
      removed.push(threadId);
    }
    if (project.groups.length === 0 && Object.keys(project.membership).length === 0) {
      delete normalized.projects[id];
    }
    return { state: normalized, threadIds: removed };
  }

  function setMigrationBlock(project, threadId, reason, now = Date.now()) {
    if (!Object.hasOwn(project.membership, threadId) || !isTransientThreadId(threadId)) return false;
    const normalizedReason = migrationBlockReason(reason) || "ambiguous-identity";
    const existing = project.migrationBlocks[threadId];
    if (existing?.reason === normalizedReason) return false;
    project.migrationBlocks[threadId] = {
      reason: normalizedReason,
      createdAt: Number.isFinite(existing?.createdAt) ? existing.createdAt : now,
    };
    return true;
  }

  function blockThreadMigrations(state, projectId, threadIds, reason = "ambiguous-identity") {
    const normalized = normalizeState(state);
    const id = text(projectId);
    if (!id) throw new Error("projectId is required");
    const project = normalized.projects[id];
    if (!project) return { state: normalized, threadIds: [] };

    const requested = new Set(
      Array.from(threadIds || [], (threadId) => text(threadId)).filter(Boolean),
    );
    const blocked = [];
    const now = Date.now();
    for (const threadId of requested) {
      if (!Object.hasOwn(project.membership, threadId) || !isTransientThreadId(threadId)) continue;
      setMigrationBlock(project, threadId, reason, now);
      blocked.push(threadId);
    }
    return { state: normalized, threadIds: blocked };
  }

  function syncThreadIdentities(state, projectId, renderedThreads, allowMigration = false) {
    const copy = projectCopy(state, projectId);
    const descriptors = [];
    for (const rawDescriptor of Array.isArray(renderedThreads) ? renderedThreads : []) {
      const id = text(rawDescriptor?.id);
      const hint = threadHint(rawDescriptor);
      if (!id || !hint) continue;
      descriptors.push({
        id,
        hint,
        migrationTarget: rawDescriptor?.migrationTarget !== false,
      });
    }
    const descriptorCounts = new Map();
    for (const descriptor of descriptors) {
      descriptorCounts.set(descriptor.id, (descriptorCounts.get(descriptor.id) || 0) + 1);
    }
    descriptors.forEach((descriptor) => {
      descriptor.duplicateId = descriptorCounts.get(descriptor.id) > 1;
    });

    let changed = false;
    const migrations = [];
    const renderedIds = new Set(descriptors.map((descriptor) => descriptor.id));
    if (allowMigration) {
      const staleSources = Object.entries(copy.project.membership).filter(([threadId]) => (
        isTransientThreadId(threadId)
        && !renderedIds.has(threadId)
        && copy.project.threadHints[threadId]
        && !Object.hasOwn(copy.project.migrationBlocks, threadId)
      )).map(([id, groupId]) => ({
        id,
        groupId,
        hint: copy.project.threadHints[id],
      }));
      const stableTargets = descriptors.filter(({ id }) => !isTransientThreadId(id));
      const targetsBySource = new Map();
      const sourcesByTarget = new Map();

      for (const source of staleSources) {
        const targets = stableTargets.filter(({ hint }) => matchingThreadHint(source.hint, hint));
        targetsBySource.set(source.id, targets);
        for (const target of targets) {
          const sources = sourcesByTarget.get(target.id) || [];
          sources.push(source);
          sourcesByTarget.set(target.id, sources);
        }
      }

      const plannedMigrations = [];
      for (const source of staleSources) {
        const targets = targetsBySource.get(source.id) || [];
        if (targets.length === 0) continue;
        if (targets.length > 1) {
          if (setMigrationBlock(copy.project, source.id, "ambiguous-source-targets")) changed = true;
          continue;
        }
        const target = targets[0];
        if (target.duplicateId) {
          if (setMigrationBlock(copy.project, source.id, "ambiguous-duplicate-target")) changed = true;
          continue;
        }
        if (Object.hasOwn(copy.project.membership, target.id)) {
          if (setMigrationBlock(copy.project, source.id, "ambiguous-grouped-target")) changed = true;
          continue;
        }
        if ((sourcesByTarget.get(target.id) || []).length !== 1) {
          if (setMigrationBlock(copy.project, source.id, "ambiguous-target-sources")) changed = true;
          continue;
        }
        if (!target.migrationTarget) continue;
        plannedMigrations.push({ source, target });
      }

      for (const { source, target } of plannedMigrations) {
        delete copy.project.membership[source.id];
        delete copy.project.threadHints[source.id];
        delete copy.project.migrationBlocks[source.id];
        copy.project.membership[target.id] = source.groupId;
        copy.project.threadHints[target.id] = target.hint;
        migrations.push({
          fromThreadId: source.id,
          toThreadId: target.id,
          groupId: source.groupId,
        });
        changed = true;
      }
    }

    const descriptorsById = new Map();
    for (const descriptor of descriptors) {
      const matches = descriptorsById.get(descriptor.id) || [];
      matches.push(descriptor);
      descriptorsById.set(descriptor.id, matches);
    }
    for (const [id, matches] of descriptorsById) {
      if (!Object.hasOwn(copy.project.membership, id)) continue;
      const hint = matches[0].hint;
      if (!matches.every((descriptor) => sameThreadHint(descriptor.hint, hint))) continue;
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
      delete copy.project.migrationBlocks[threadId];
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
    MAX_MIGRATION_BLOCK_REASON_LENGTH,
    emptyState,
    normalizeState,
    createGroup,
    renameGroup,
    setCollapsed,
    toggleGroup,
    assignThread,
    unassignThreads,
    blockThreadMigrations,
    syncThreadIdentities,
    deleteGroup,
    isTransientThreadId,
    uniqueName,
  });
})();

//# sourceURL=codex-session-groups-model.js
