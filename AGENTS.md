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

## Before reporting any task done

Run `npm run check` (lint + typecheck + tests) and paste the real output.
Evidence over claims.

## Commits

Small and focused, one logical change each, prefixed with the task id:
`[T-003] feat: screenToWorld`. Never one giant commit.

## Report format (Implementer → Planner) — PLAN §2

```
# REPORT T-xxx
## Summary                 (2–3 lines)
## Acceptance checklist    (each criterion: done / not done + evidence)
## Decisions made          (small choices; "none" if none)
## Questions / deviations  (conflicts with PLAN or brief; "none" if none)
## Risks noticed
## Suggestions             (not done, only proposed)
```
