# Working agreement

This is a small personal side project. Keep it independent from company repositories.

- `STATUS.md` is the current-state and idea ledger. Update it before ending non-trivial work.
- Do not patch `/Applications/ChatGPT.app` or edit `~/.codex/.codex-global-state.json`.
- Session grouping is visual metadata only. Never make a Codex task aware of its group.
- Never archive, restore, delete, or otherwise mutate a Codex task. An explicit native archive may remove only that task's visual group membership after its sidebar row disappears; DOM absence alone is never proof of archival.
- A temporary `client-new-thread` ID may be migrated only from saved visual metadata when the project list is fully rendered and the title/host/kind fingerprint has exactly one unassigned stable-ID match. Ambiguity must fail closed.
- Keep runtime dependencies at zero unless a concrete need is proven.
- Injection must fail closed when expected semantic DOM markers are absent.
- Test against an isolated Codex profile before attaching to the user's primary window.
