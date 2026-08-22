# Working agreement

This is a small personal side project. Keep it independent from company repositories.

- `STATUS.md` is the current-state and idea ledger. Update it before ending non-trivial work.
- Do not patch `/Applications/ChatGPT.app` or edit `~/.codex/.codex-global-state.json`.
- Session grouping is visual metadata only. Never make a Codex task aware of its group.
- Never archive, restore, delete, or otherwise mutate a Codex task. An explicit native archive may remove only that task's visual group membership after its sidebar row disappears; DOM absence alone is never proof of archival.
- A temporary `client-new-thread` ID may migrate directly when the same DOM row still carries the injected old ID, project, group, and exact title/host/kind lineage. Fingerprint-only migration requires a fully rendered project list and exactly one unassigned stable-ID match. Ambiguity must fail closed.
- Keep runtime dependencies at zero unless a concrete need is proven.
- Injection must fail closed when expected semantic DOM markers are absent.
- A group is only a projection of the task rows Codex currently renders in that project list. Missing saved memberships stay silent: do not count them, auto-page for them, block group interactions, or delete them merely because a DOM row is absent. If the exact task ID appears again, its saved visual membership may be projected again.
- Test against an isolated Codex profile before attaching to the user's primary window.
