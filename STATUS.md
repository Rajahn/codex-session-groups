# Status

Updated: 2026-08-10

## Current

- v0.1.2 implemented: local-only visual groups inside each Codex workspace project.
- Scope: create, rename, delete, expand/collapse, and drag tasks into or out of a group.
- Persistence: renderer `localStorage`; Codex task data and global state remain untouched.
- Delivery: CDP launcher plus two injected scripts; no server, database, cloud, AI, or automation.
- Repository: private personal GitHub repository at `https://github.com/Rajahn/codex-session-groups`.
- Archive fix: an explicit native archive removes only the archived task's visual membership after its row disappears. Restored tasks therefore return ungrouped.
- Safety boundary: DOM absence alone never prunes membership; the injector never calls Codex archive, restore, or delete APIs.
- Availability fix: expanding a group may trigger Codex's native “展开显示” once so remaining rendered members stay together.
- Restart identity fix: grouped tasks save a minimal title/host/kind fingerprint. A missing `client-new-thread` ID is re-keyed only when a fully rendered project has exactly one matching unassigned stable ID.
- Identity safety: partial lists, missing legacy fingerprints, duplicate source fingerprints, duplicate candidate titles, and already-grouped targets do not migrate.
- Verified against an isolated Codex 26.803.41515 profile: explicit archive, no passive pruning, native reveal, temporary-to-stable restart migration, partial-list and duplicate-title refusal, safe takeover from an older renderer script, and 15 automated checks.
- Applied to the primary profile: `梳理质检任务 SIT 测试状态` and `分析商责单延迟写入原因` were migrated from their confirmed temporary IDs to stable IDs after a localStorage backup. `质检分支实现` now has 3/3 rendered rows and `售后与商责单` has 1/1.

## Constraints

- This is an unsupported UI injection and may require selector updates after Codex releases.
- Pinned tasks stay in Codex's native pinned section. Their saved group becomes visible again when unpinned.
- Only currently rendered project tasks can be dragged; use Codex's native “展开显示” control for older tasks.
- Exact duplicate title/host/kind fingerprints intentionally remain unresolved after restart instead of guessing the target task.
- The group UI appears only when Codex is launched through this project's launcher. Normal restart preserves `localStorage`, but a normal Dock/Spotlight launch does not inject the UI.

## Next

- Continue user trial in the primary Codex profile; the current renderer is already running v0.1.2.
- Consider a separate opt-in startup convenience only if command-line launching becomes a recurring burden; do not turn this project into a background service by default.
- If a future Codex release changes semantic sidebar hooks, update selectors and rerun the isolated smoke test.
