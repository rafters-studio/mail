---
name: Implementation Task
about: Implementation task for AI agents with full dev workflow
title: "feat: [brief description]"
labels: enhancement
assignees: ""
---

## Goal

**Single, focused objective this task achieves.**

## Requirements

### Interface

```typescript
// Exact type definitions, route signatures, or API shape expected
```

### Behavior

- Specific requirement 1 with clear success criteria
- Specific requirement 2 with measurable outcome
- Specific requirement 3 with validation method

### Error Handling

- What errors to return and when
- Required error types and status codes

## Out of Scope

- Feature 1 (separate issue)
- Feature 2 (future consideration)

## File Locations

- Implementation: `packages/path/to/module.ts`
- Tests: `tests/path/to/module.test.ts`

## Dev Workflow

Each step is mandatory. Do not skip steps or combine them.

1. **Build** -- Implement the feature. Write tests alongside code. Run `pnpm test`, `pnpm check` (oxlint + oxc-format). All must pass.
2. **Simplify** -- Run `/simplify` on all changed files. Accept structural improvements, flatten unnecessary abstractions, remove dead code.
3. **Review** -- Run `/review-pr` which launches parallel review agents (code review, silent failure hunter, type design analysis). Do not create the PR yet.
4. **Fix** -- Address every issue the review found. Re-run tests after fixes.
5. **PR** -- Create the PR. Reference this issue number.

### Mail Rules

- No `any` -- use `unknown` and narrow
- No emoji in code, comments, or commits
- UUIDv7 for all identifiers
- Zod is source of truth for schemas (types inferred via `z.infer<>`)
- Zero vendor dependencies in core -- all external concerns are adapters
- Factory pattern for adapters (`createXxxProvider(config)` not classes)
- pnpm only (never npm/yarn)
- oxlint for linting, oxfmt for formatting (no Biome)
- TypeScript 5.9, Vitest 4, Zod 4
- No barrel files -- use subpath exports in package.json
- Tests in `tests/` mirroring source tree, never colocated
- Zocker for mock data from Zod schemas
- Constructor mocks use `class` syntax: `vi.fn(class )` not arrow functions (Vitest 4)
- Use `mockReset()` not `clearAllMocks()` for mocks with rejection overrides

## Done When

- [ ] All tests pass
- [ ] Simplify pass completed
- [ ] Review pass completed and issues fixed
- [ ] PR created and linked to this issue

**This issue is complete when:** [Specific, measurable completion condition]

## Context

- Related issues: #N, #M
- Design docs: link if applicable
