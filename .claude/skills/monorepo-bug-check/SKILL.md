---
name: monorepo-bug-check
description: Cross-cutting bug check across apps/app, cli/poit, and infra for the poit monorepo. Use after any change that touches more than one of those three directories, or whenever the user asks to check the whole repo/architecture for consistency bugs. Checks that the three components still agree with each other (API contract, auth model, TTL values, deploy config, binding names) per ARCHITECTURE.md.
---

# monorepo-bug-check

poit is one service split across three directories that all have to agree with each other: `apps/app` (Worker + SPA), `cli/poit` (Go CLI), `infra` (Terraform, the only deploy path). A change that's correct in isolation can still break the contract between them. This skill finds those cross-cutting bugs specifically — it is not a general code-quality review.

## Before anything else

Read `/Users/r/orca/ageage/ARCHITECTURE.md`. It lists the specific cross-component contracts this check exists to protect (API shape, auth/Access model, the 90-day TTL kept in sync between `store.ts` and `infra/main.tf`, the wrangler.jsonc-vs-terraform binding names, the `_headers` handling, the slug regex duplicated three times, the Access path-matching model). Treat that list as the primary checklist, not just background reading — if ARCHITECTURE.md itself looks out of date relative to the code, that's a finding too (flag it, and update the doc once the rest of the check is done).

## What to run

- **First run / explicit "check the whole repo" request**: review the current state of all three directories broadly against ARCHITECTURE.md's contracts — don't limit yourself to a diff.
- **Every other invocation**: this fires after a change, so scope the check to what actually changed: `git diff` (or `git diff <base>..<head>` if a range is given) touching any of `apps/`, `cli/`, `infra/`. For each changed file, ask "does this change something another component assumes is true?" — e.g. renaming a JSON field in `index.ts`'s `ArtifactWriteBody` without updating `client.go`'s `artifactRequest`; changing a TTL constant in one place but not the other; adding an API route without deciding whether `infra/main.tf`'s Access Applications should treat it as protected or bypassed; changing a binding name in `main.tf` without updating `wrangler.jsonc`; editing `public/_headers` without remembering it must be re-applied via `terraform apply` (not picked up automatically).

## How to check

1. Read the changed files (or, on a full review, at minimum: `apps/app/src/index.ts`, `apps/app/src/store.ts`, `apps/app/src/access.ts`, `apps/app/src/mime.ts`, `apps/app/src/metadata.ts`, `apps/app/frontend/src/lib/api.ts`, `apps/app/frontend/src/pages/Home.tsx`, `cli/poit/cmd/client.go`, `cli/poit/cmd/share.go`, `infra/main.tf`, `apps/app/wrangler.jsonc`, `.github/workflows/ci.yml`).
2. For each contract in ARCHITECTURE.md's "三者間の契約" section, verify both/all sides still match. Don't just pattern-match names — trace the actual value (e.g. confirm the TTL in `store.ts` and the lifecycle rule's `max_age` in `main.tf` are the same number of seconds, not just that both exist).
3. Only report a finding if you can point to two concrete locations (file:line each) that now disagree, or a location that assumes something no longer true elsewhere. Vague "this could be inconsistent" without a concrete pair is not a finding.

## Output

Report findings most-severe first: file/line pair, what the mismatch is, and the concrete fix (which side should change to match the other, or both). If nothing is wrong, say so briefly — don't manufacture findings. Keep it a punch list, not prose.
