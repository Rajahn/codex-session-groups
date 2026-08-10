import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../inject/session-groups.user.js", import.meta.url), "utf8");

test("uses semantic Codex hooks and local-only visual metadata", () => {
  assert.match(source, /data-app-action-sidebar-project-row/);
  assert.match(source, /data-app-action-sidebar-project-list-id/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /codex-session-groups:v1/);
  assert.match(source, /new MutationObserver\(scheduleRender\)/);
  assert.doesNotMatch(source, /\.codex-global-state\.json/);
  assert.doesNotMatch(source, /electronBridge/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("contains the agreed native-like interactions", () => {
  assert.match(source, /新建分组/);
  assert.match(source, /重命名分组/);
  assert.match(source, /删除分组（保留会话）/);
  assert.match(source, /contextmenu/);
  assert.match(source, /dragstart/);
  assert.match(source, /aria-expanded/);
});

test("only removes visual membership after an explicit native archive disappears", () => {
  assert.match(source, /归档聊天\|archive chat/);
  assert.match(source, /scheduleArchiveReconciliation/);
  assert.match(source, /if \(!threadExistsAnywhere\(pending\.observedThreadId\)\)/);
  assert.match(source, /model\.unassignThreads/);
  assert.match(source, /rekeyPendingMembershipChecks/);
  assert.match(source, /transientAliasContextForRow/);
  assert.match(source, /:scope > \.csg-drag-handle\[data-csg-thread-id\]/);
  assert.match(source, /model\.blockThreadMigrations/);
  assert.match(source, /ambiguous-archive-target/);
  assert.doesNotMatch(source, /blockedTransientMigrations/);
  assert.doesNotMatch(source, /scheduleMissingMembershipReconciliation/);
  assert.doesNotMatch(source, /set_thread_archived|setThreadArchived/);
});

test("a newer injection takes over an older renderer script", () => {
  assert.match(source, /existing\?\.version === VERSION/);
  assert.match(source, /existing\?\.destroy\?\.\(\)/);
  assert.match(source, /model\.IMPLEMENTATION_VERSION !== VERSION/);
});

test("upgrades temporary thread ids only through the model's guarded identity sync", () => {
  assert.match(source, /threadDescriptorForRow/);
  assert.match(source, /model\.syncThreadIdentities/);
  assert.match(source, /project-show-all["']\) === ["']true/);
  assert.match(source, /data-app-action-sidebar-thread-title/);
  assert.match(source, /migrationTarget: false/);
  assert.doesNotMatch(source, /querySelector.*client-new-thread/);
});

test("fails open when Codex has not loaded saved group members", () => {
  assert.match(source, /analyzeProjectAvailability/);
  assert.match(source, /availability\.incomplete/);
  assert.match(source, /restoreManagedThreadRows/);
  assert.match(source, /restoreOrphanedManagedThreadRows/);
  assert.match(source, /data-csg-managed-thread-row/);
  assert.match(source, /data-csg-managed-thread-wrapper/);
  assert.match(source, /nativeRows\.forEach\(\(\{ row, wrapper \}\) => restoreThreadRow/);
  assert.match(source, /项目列表可见/);
  assert.match(source, /当前暂不折叠项目列表/);
});

test("reveal retries are scoped to the current list signature", () => {
  assert.match(source, /groupRevealSignature/);
  assert.match(source, /currentList !== run\.list/);
  assert.match(source, /groupRevealRuns/);
  assert.doesNotMatch(source, /attemptedGroupReveals/);
  assert.match(source, /scheduleProjectMembersReveal/);
});

test("prunes disconnected wrappers retained by previous list mounts", () => {
  assert.match(source, /pruneRuntimeTrackers/);
  assert.match(source, /if \(!element\?\.isConnected\) touchedOrderElements\.delete\(element\)/);
});

test("destroyed renderers cannot be revived by delayed callbacks", () => {
  assert.match(source, /if \(destroyed \|\| renderFrame\) return/);
  assert.match(source, /if \(destroyed \|\| rendering\) return/);
  assert.match(source, /destroyed = true/);
});
