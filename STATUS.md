# Status

Updated: 2026-08-10

## Current

- v0.1.3 is attached to the primary renderer and passed exact-version readback. The pre/post `storageRaw` values are byte-identical: 3 groups, 5 memberships, and 5 thread hints were preserved.
- Scope remains local-only visual groups: create, rename, delete, expand/collapse, and drag tasks into or out of a group. No task content, context, branch, Goal, archive state, or worktree is changed.
- Persistence remains renderer `localStorage` under `codex-session-groups:v1`; runtime dependencies remain zero. `happy-dom` is dev-only for executable DOM lifecycle tests.
- Incident recovery: the primary profile reported `质检分支实现 3` with only one rendered member. Codex's native task index and `read_thread` confirmed both missing active tasks and their full history still existed. v0.1.2 was destroyed without touching localStorage, the 5 saved memberships were backed up to `/private/tmp/codex-session-groups-backup-20260810T1733.json`, and the two missing native entries were temporarily pinned so they are reachable.
- Root cause boundary: the permanent reveal latch survived native list remounts, while Codex's own project list could still omit active tasks even after `show-all=true`. A persisted count therefore looked healthy while the native rows were absent.
- v0.1.3 fail-open behavior: if any saved stable member is absent from the current DOM, the project shows `visible/total`, preserves every membership, and temporarily applies no native-row hiding or ordering. It resumes grouping only after Codex renders the missing rows.
- Reveal retries are now keyed to the current list instance, show-all state, and row-ID signature; list remount and true-to-false reset create a fresh epoch.
- Archive reconciliation now follows guarded temporary-to-stable ID migrations instead of abandoning the pending archive check under the old ID. Reverse-order archive fallback also requires one globally unique stable row; same-fingerprint project or pinned duplicates fail closed and temporarily block later migration.
- Identity migration builds the complete source-target match graph before mutation. Already-grouped and outside-project/pinned matches remain ambiguity blockers; only a strict one-to-one eligible project target can migrate.
- Prototype-key dictionaries are hardened with null-prototype maps so reserved IDs cannot corrupt state.
- Launcher reliability: injection is recorded only after exact v0.1.3 readback; per-target and debugger transport failures retry without killing the watcher; loopback target identity and port are checked; `open -W` is unreferenced so `--once` can exit.
- Automated verification: 43/43 checks pass, including Happy DOM lifecycle tests for incomplete fail-open/recovery, remount and show-all reset, both archive/ID-migration orderings, project and pinned duplicate ambiguity blocking, shared multi-group reveal, delayed-callback destroy safety, and disconnected-wrapper cleanup; launcher loop tests cover fetch recovery, empty-target once failure, retry, signal exit, and shutdown warning suppression.
- Isolated renderer smoke passed on a `/private/tmp` profile: normal collapsed membership produced `data-csg-hidden=true`; adding one unavailable saved member changed the group to `1/2`, `incomplete=true`, forced-open the header, and restored the native row to visible/ungrouped. Test localStorage and injected nodes were then cleared and the isolated PID was closed; the primary PID/port remained alive.
- Primary renderer verification passed: `质检分支实现` renders `1/3` because the two recovered active tasks remain in the native pinned section; both pinned rows and every project row are connected and visible, and no task wrapper has a hidden marker.

## Constraints

- This is an unsupported UI injection and may require selector updates after Codex releases.
- Pinned tasks remain in Codex's native pinned section; groups show project-visible versus saved membership counts.
- Only currently rendered project tasks can be dragged. Native absence is never treated as archive proof.
- Exact duplicate or overlapping title/host/kind fingerprints intentionally remain unresolved rather than guessing.
- The group UI appears only when Codex is launched or attached through this project's launcher. Normal restart preserves localStorage but a Dock/Spotlight launch does not inject the UI.

## Next

- Remove the two temporary recovery pins only when their project-list entries are independently visible; do not trade accessibility for cosmetic cleanup.
- If a future Codex release changes semantic sidebar hooks, update selectors and rerun the isolated smoke test before attaching to the primary profile.
