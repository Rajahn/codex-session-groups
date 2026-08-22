# Status

Updated: 2026-08-22

## Current

- v0.1.10 is attached to the primary Codex renderer on loopback debugger port 60961, with a v0.1.10 attach watcher running for renderer remounts. The older v0.1.9 launch watcher was stopped so a future renderer cannot reintroduce the bug.
- Root cause fixed: v0.1.9 required every saved stable membership to be rendered before any temporary-to-stable migration. Codex currently paginates the project list, so one missing older row blocked unrelated live rows and left valid tasks attached to stale `client-new-thread` IDs.
- Same-row identity changes now use exact retained lineage: the native row's new stable ID plus the injected old ID, project, group, and exact title/host/kind. This path does not depend on full pagination. It fails closed if the target is already grouped or any lineage field differs.
- Restart-only fingerprint matching remains unchanged and conservative: it still requires a fully rendered project list and a unique source-target graph. Pinned/outside rows, duplicate fingerprints, existing target memberships, and durable migration blocks prevent guessing.
- Five currently proven mappings were repaired from stale temporary IDs to active stable IDs: `Review 质检分支上线风险`, `分析 traction QC Dify 输入契约`, `分析售后赔付扣款时序`, `确认订单治理灰度范围`, and `核查履约10%灰度判责问题`. Each stable task was rechecked in `local_thread_catalog` for the exact `fulishe-services` cwd with `missing_candidate=0`, and each has one active session file and no archived-session file.
- Repair was visual metadata only. The primary state retained 23 memberships and 23 hints with zero migration blocks; no Codex task was archived, restored, deleted, renamed, or otherwise mutated. The exact pre-repair storage is preserved in renderer localStorage as `codex-session-groups:backup:before-0.1.10-20260822`.
- Primary readback after v0.1.10 attachment: `质检分支实现 5`, `售后与商责单 1`, and `履约判责分析 2`; all eight currently rendered member rows carry the expected group ID. Counts remain current-visible counts only.
- Two old transient metadata entries were deliberately left untouched: `梳理 QA QC 工作流现状` already has a separate stable membership, while `核查QIC订单揽收超时判定` has no exact current catalog target. Neither is used as evidence to delete or reassign a task.
- Isolated-profile verification loaded the copied 23-membership primary state under v0.1.10, collapsed and reopened a group, preserved memberships/hints/migration blocks, and left the native `展开显示` control untouched. The isolated process was stopped and its temporary profile was moved to Trash afterward.
- Automated verification is 53/53 with `git diff --check` clean. Coverage now includes exact migration with `show-all=false`, an unrendered saved member, and zero native pagination clicks, plus existing archive, pin/unpin ambiguity, remount, cleanup, native menu, and launcher behavior.
- Scope remains local-only visual groups. Runtime dependencies remain zero; `happy-dom` is development-only. The v0.1.10 source, tests, and documentation are committed and pushed to the private personal `origin/main` repository.

## Constraints

- This is an unsupported UI injection and may require semantic-selector updates after Codex releases.
- Pinned tasks remain in Codex's native pinned section and do not count as currently visible project-group members.
- Only currently rendered project tasks can be dragged. Native absence is never treated as archive proof.
- Exact duplicate or overlapping title/host/kind fingerprints intentionally remain unresolved rather than guessing.
- A durably blocked or otherwise stale membership can remain stored silently until the exact task returns, the task is explicitly ungrouped, or its visual group is deleted.
- The group UI appears only when Codex is launched or attached through this project's launcher. Normal restart preserves localStorage, but a Dock/Spotlight launch does not inject the UI.

## Next

- On the next full app restart, launch through this repository's current launcher so v0.1.10 and its watcher are loaded from disk.
- If a future Codex release changes semantic sidebar hooks, rerun the isolated smoke test before attaching to the primary profile.
