## OpenCode Addendum

These notes apply only inside OpenCode sessions.

- The OpenCode subagent dispatch primitive is `task`.
- A `task` result that only returns a session id/title is a launch acknowledgement, not a completed application outcome.
- Do not use `task` to poll status. Inspect tracker files, workflow artifacts, or `iso-trace` instead.
- When JobForge says "dispatch" or "subagent" in the shared contract, map that to OpenCode `task` calls here.
