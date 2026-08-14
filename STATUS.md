# Status

Updated: 2026-08-14

## Current

- v0.1.9 is attached to the primary Codex renderer on loopback debugger port 64782, with a v0.1.9 attach watcher running for renderer remounts. It replaces the launch-time v0.1.8 watcher so a new renderer cannot reintroduce the removed completeness logic.
- The grouping model is now deliberately simple: a group projects only the task rows Codex currently renders inside that project list. Counts are current visible counts only; a saved `1/3` state therefore renders as `1`, not `1/3`.
- Missing saved memberships are silent. They do not trigger native pagination, warning UI, forced expansion, interaction blocking, or project-wide fail-open. They also are not deleted from DOM absence alone. If the exact task ID is rendered again, its saved visual membership is projected again.
- Explicit native archive safety is unchanged: only a user-originated native archive intent followed by disappearance of that exact observed row can remove visual membership. Restored tasks return ungrouped. No injection path archives, restores, deletes, renames, or otherwise mutates a Codex task.
- Temporary-to-stable ID migration remains guarded by a complete, unique identity graph. Pinned/outside rows and duplicate fingerprints block guessing; durable `migrationBlocks` survive renderer restarts.
- Primary readback after attachment: v0.1.9, 33 native `fulishe-services` rows, `质检分支实现 4`, `售后与商责单 5`, and `履约判责分析 2`; all three groups are expanded and none has an incomplete marker. `storageRaw` is byte-identical to the pre-v0.1.9 snapshot: 3 groups, 12 memberships, 12 thread hints, and zero migration blocks.
- Isolated-profile verification used the copied primary storage with Codex initially rendering only 5 project rows. Each group displayed `1`, no incomplete marker appeared, click-to-collapse hid the one rendered member, click-to-reopen restored it, no native show-more action was triggered, and the 12 saved memberships stayed intact. The isolated API/storage were cleared and the isolated process was stopped afterward.
- Automated verification is 51/51 with `git diff --check` clean. Coverage includes current-row projection, missing members not blocking interactions or clicking native pagination, list remount projection, orphaned managed-row cleanup, archive/ID-migration orderings, durable ambiguity blocking, native-shaped menu injection, renderer cleanup, and launcher retries.
- v0.1.9 product, tests, README, working agreement, version chain, and status are committed and pushed to the private personal `origin/main` repository.
- Scope remains local-only visual groups: create, rename, delete, expand/collapse, and drag currently rendered tasks into or out of a group. Runtime dependencies remain zero; `happy-dom` is development-only.
- Persistence remains renderer `localStorage` under `codex-session-groups:v1`. The injection never edits `/Applications/ChatGPT.app` or `~/.codex/.codex-global-state.json`.

## Constraints

- This is an unsupported UI injection and may require semantic-selector updates after Codex releases.
- Pinned tasks remain in Codex's native pinned section and do not count as currently visible project-group members.
- Only currently rendered project tasks can be dragged. Native absence is never treated as archive proof.
- Exact duplicate or overlapping title/host/kind fingerprints intentionally remain unresolved rather than guessing.
- A durably blocked or otherwise stale membership can remain stored silently until the exact task returns, the task is explicitly ungrouped, or its visual group is deleted.
- The group UI appears only when Codex is launched or attached through this project's launcher. Normal restart preserves localStorage, but a Dock/Spotlight launch does not inject the UI.

## Next

- On the next full app restart, launch through this repository's current launcher so v0.1.9 and its watcher are loaded from disk.
- If a future Codex release changes semantic sidebar hooks, rerun the isolated smoke test before attaching to the primary profile.
