# AGENTS.md — VexBoard

**Read `docs/PLAN.md` first.** It is the single source of truth for
architecture, decisions and workflow. Sections 2 (workflow), 3 (locked
decisions), 4 (architecture) and 5 (invariants) are **binding**.

## Rules of engagement (from PLAN §2)

- Order of authority: task brief > PLAN.md > your own assumptions.
  If two conflict → stop and ask. Never resolve it silently.
- Follow the task brief exactly; no scope creep. Worth doing something
  else? Put it under *Suggestions* in the report — do not do it.
- No silent decisions: small reversible choices go under *Decisions made*;
  anything touching state layers, coordinates, commands/history or the
  file format → stop and ask first.
- Locked decisions (§3) and invariants (§5) are binding. Disagree → say so
  in the report with a reason; never work around them.

## Workflow rules 7–13 (PLAN §2)

- Evidence over claims: before reporting a task done, run `npm run check:all`
  and paste the real command output as plain text in fenced blocks, plus the
  green CI run URL of the pull request.
- Branches: one branch per task, `task/T-xxx-slug`, cut from an up-to-date
  `main`; never commit to `main`. The Owner merges PRs with a merge commit
  (no squash); the implementer never merges.
- Deliberate-breakage experiments (proving a test or gate can fail) run only
  on a throwaway branch, never on the task branch, and are never merged.
- Secrets: never write a token, password or key into any file inside the
  repo working tree, tracked or not, and never commit one. Credentials live
  in a credential helper or environment variable outside the repo; tokens
  are fine-grained, limited to this repository, and expire.
- Commits: small, focused, one logical change each, prefixed with the task
  id, e.g. `[T-003] feat: screenToWorld`. Never one giant commit.
- Reports start with the head SHA; all evidence refers to it. Never
  force-push a pushed branch unless approved; if history is rewritten, say
  so with before/after SHAs and the reason (rule 12).
- Quota discipline: follow the brief's priority order; push after every
  commit; if budget runs low, stop at a clean boundary and list what
  remains (rule 13).
- This file: 50 lines at most (rule 11).

## Report format (Implementer → Planner) — PLAN §2

```
# REPORT T-xxx — Summary / Acceptance checklist (each: done + evidence)
# Decisions made / Questions or deviations / Risks noticed / Suggestions
```
