# Status

Updated: 2026-08-10

## Current

- v0.1.6 is attached to the primary renderer: the verified API version changed from v0.1.5 before injection to v0.1.6 after injection. The release changes are not yet committed or pushed.
- Scope remains local-only visual groups: create, rename, delete, expand/collapse, and drag tasks into or out of a group. No task content, context, branch, Goal, archive state, or worktree is changed.
- Persistence remains renderer `localStorage` under `codex-session-groups:v1`; runtime dependencies remain zero. `happy-dom` is dev-only for executable DOM lifecycle tests.
- Earlier incident evidence: after the user removed the two temporary recovery pins, `质检分支实现` stalled at `1/3`. Codex's native task index still contained all three tasks under the same project and showed both recovered tasks as unpinned; the grouping `storageRaw` remained byte-identical at 3 groups, 5 memberships, and 5 thread hints.
- Live DOM evidence showed 15 project rows, a visible enabled native “展开显示” control, and `data-app-action-sidebar-project-show-all="true"`. Clicking only that native control paged 15→25→26 rows; one missing grouped task appeared on each page, the control then disappeared, and the group recovered to `3` with no hidden markers. Storage stayed unchanged throughout.
- State-transition audit: immediately before the final injection, the current primary profile had independently changed to 3 groups, 4 memberships, and 4 thread hints, with `质检分支实现 2`. The visual mapping for `梳理质检任务 SIT 测试状态` (`019fdc9d-b46e-7420-b286-071213b31ff7`) was no longer in storage, although the underlying task remained readable by ID. No older 5-membership snapshot was restored; injection preserved the user's then-current 4-membership state rather than overwriting intervening actions.
- Root cause: v0.1.5 trusted the stale `show-all=true` attribute before checking the real control, so it declared the list incomplete without clicking the still-available next page. The attribute remained `true` across both successful native pages and cannot be used as completion truth.
- v0.1.6 treats a visible enabled native “展开显示” control as the live paging signal. It clicks each page signature once, permits another click only after the native thread-ID set strictly expands, caps each project reveal chain at 8 clicks, and halts fail-open on no progress, ID reduction/replacement, disabled/hidden controls, or exhausted budget. A project that was complete while members were pinned starts a fresh bounded chain when unpinning makes it incomplete.
- Fail-open remains authoritative: if any saved stable member is absent from the current DOM, the project shows `visible/total`, preserves every membership, and temporarily applies no native-row hiding or ordering. A previously managed row that loses its native thread ID is also restored immediately, including during destroy.
- Archive reconciliation now follows guarded temporary-to-stable ID migrations instead of abandoning the pending archive check under the old ID. Reverse-order archive cleanup accepts only direct membership or the same DOM row's exact old transient ID; fingerprints are never used as deletion authority. A pinned stable row without project DOM context can only persistently block matching transient sources, never delete them.
- Identity migration builds the complete source-target match graph before mutation. Already-grouped and outside-project/pinned matches remain ambiguity blockers; only a strict one-to-one eligible project target can migrate. Observed ambiguity is persisted per transient ID in `migrationBlocks`, so reducing candidates or restarting the renderer cannot turn a prior ambiguity into a later guess.
- Prototype-key dictionaries are hardened with null-prototype maps so reserved IDs cannot corrupt state.
- The v0.1.6 launcher requires exact v0.1.6 readback before recording an injection; per-target and debugger transport failures still retry without killing the watcher, and loopback target identity and port remain checked.
- Automated verification: 64/64 checks pass. The reveal-state-machine baseline passed 62/62; the final suite adds observer regressions for native hidden/disabled controls becoming eligible and for non-form `[role="button"]` controls carrying `disabled`. Coverage includes stale-attribute multi-page reveal, same-page deduplication, strict ID progress, the 8-click cap, no-progress/regression/remount latches, unpin complete→incomplete restart, incomplete fail-open/recovery, archive/ID-migration orderings, durable ambiguity blocking, renderer cleanup, and launcher retries.
- Isolated v0.1.6 renderer smoke passed: a normal collapsed membership produced `collapsedHidden=true`; adding one missing saved member produced `1/2`, `incomplete=true`, and `expanded=true`, while the native row stayed visible and ungrouped (`nativeHidden=false`, `grouped=false`). Test storage and the injected API were cleared, isolated port 60892 closed, and the primary port 60789 remained alive.
- Primary verification passed with byte-identical pre/post `storageRaw`: 3 groups, 4 memberships, and 4 thread hints. `质检分支实现` renders `2`; both member rows are connected, grouped, and `display: block`, with `hiddenCount=0` and `incomplete=false`. Delayed diagnostics reported `membershipChecks=0`.

## Constraints

- This is an unsupported UI injection and may require selector updates after Codex releases.
- Pinned tasks remain in Codex's native pinned section; groups show project-visible versus saved membership counts.
- Only currently rendered project tasks can be dragged. Native absence is never treated as archive proof.
- Exact duplicate or overlapping title/host/kind fingerprints intentionally remain unresolved rather than guessing.
- A durably blocked transient mapping may remain as a visible saved-count mismatch until it is explicitly ungrouped or its group is deleted; this is an intentional fail-closed tradeoff.
- The group UI appears only when Codex is launched or attached through this project's launcher. Normal restart preserves localStorage but a Dock/Spotlight launch does not inject the UI.

## Next

- Deployment and storage-preservation verification are complete; no further renderer injection or state migration is pending.
- Commit and push the verified v0.1.6 release changes.
- If a future Codex release changes semantic sidebar hooks, update selectors and rerun the isolated smoke test before attaching to the primary profile.
