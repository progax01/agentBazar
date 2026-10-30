# AgetBazar — Unified Audit Engine + BlockRun AI Integration

## Summary
Refactor the analysis pipeline so that a single `AuditOrchestrator` is the only place that runs Solidity audits. Both the existing escrow task flow and the x402 Services page call it. BlockRun AI is added as a paid outgoing x402 call — payment for inference is independent from the score the contract receives.

## Architecture

### Core principle
- **One engine, two entry points.** No AI prompts, scoring logic, or tool invocations outside `audit-orchestrator.ts`.
- **Payment and audit success are separate.** BlockRun is paid on a successful inference call regardless of the contract's score. Escrow pay/refund is decided after reviewing the full report.
- **BlockRun gateway:** `testnet.blockrun.ai` (Base Sepolia, `eip155:84532`) for dev; `arc.blockrun.ai` (`eip155:5042002`) for Arc mainnet. Controlled by `BLOCKRUN_GATEWAY` + `BLOCKRUN_NETWORK` env vars.

### Pipeline (AuditOrchestrator)
```
Stage 1  — Normalize source, keccak256 hash, write to tmp dir
Branch A — BlockRun AI: x402 outgoing call via @x402/fetch + ExactEvmScheme (paid from BLOCKRUN_AI_PAYER_KEY)
Branch B — Solc: compile, AST scan, warning parse, heuristic scan
Branch C — Slither: JSON output, detector → finding mapping (if installed)
A+B+C run in parallel via Promise.all
Stage 4  — Correlate: AI + tool findings matched by keyword + line proximity → corroborated
Stage 5  — Deduplicate: same title+line = keep first
Stage 6  — Score (policy v1): critical −40, high −20, medium −8, low −2, info 0 → 0–100
Stage 7  — Build AuditReport v2, emit progress events, return
```

### Finding origins
| Origin | Meaning |
|---|---|
| `tool_confirmed` | Solc / Slither detected it |
| `ai_identified` | BlockRun only |
| `corroborated` | Both tool and AI agree (counted once) |
| `unverified` | Insufficient evidence |

### Scoring policy v1
| Severity | Penalty |
|---|---|
| Critical | 40 |
| High | 20 |
| Medium | 8 |
| Low | 2 |
| Info | 0 |
Score = max(0, 100 − total). PASS ≥70, REVIEW_REQUIRED ≥40, FAIL <40.

## Files to Create / Modify

### New files
1. `services/worker/src/audit-orchestrator.ts` — the single audit engine (all logic)
2. `supabase/migrations/005_audit_runs.sql` — `audit_runs` table (auditId, entryPoint, taskId, sourceHash, score, verdict, report JSONB, blockrunReceipt, createdAt)
3. `apps/web/app/api/audit/route.ts` — Next.js API route: accepts `{ sourceCode }`, runs orchestrator, streams SSE progress, returns AuditReport
4. `apps/web/app/analyze/page.tsx` — Analyze page: paste/upload Solidity, watch live progress steps, view full report inline

### Modified files
5. `services/worker/src/provider-worker.ts` — delete inline analysis; call `runAudit()` from orchestrator; pass `BLOCKRUN_AI_PAYER_KEY` from env
6. `services/worker/src/x402-server.ts` — replace stub capability endpoint with full `POST /api/paid/audit` route that calls `runAudit()` and returns AuditReport; price 0.50 USDC per call
7. `services/worker/src/report-validator.ts` — update schema check for `AuditReport` v2 (schemaVersion 2, score field, verdict)
8. `packages/shared/src/types.ts` — add `AuditReport`, `AuditFinding`, `ScoreBreakdown`, `BlockRunReceipt`, `ToolCoverage` types; deprecate v1 `Report`
9. `apps/web/app/tasks/[id]/page.tsx` — show score ring, verdict badge, origin badges per finding (tool/AI/corroborated), BlockRun receipt with tx link, slither detector IDs, AI exploit/suggestion fields
10. `apps/web/components/NavBar.tsx` — add "Analyze" nav link
11. `apps/web/globals.css` — score ring CSS animation
12. `.env.example` + both `.env` files — add `BLOCKRUN_AI_PAYER_KEY`, `BLOCKRUN_GATEWAY`, `BLOCKRUN_NETWORK`, `BLOCKRUN_MODEL`

## Build Sequence
1. Write `audit-orchestrator.ts` (pure TypeScript, no framework)
2. Update shared types (`packages/shared/src/types.ts`)
3. Update `provider-worker.ts` to call `runAudit()`
4. Update `x402-server.ts` paid endpoint to call `runAudit()`
5. Update `report-validator.ts` for v2 schema
6. Write DB migration `005_audit_runs.sql`
7. Write `apps/web/app/api/audit/route.ts` (SSE streaming)
8. Write `apps/web/app/analyze/page.tsx`
9. Update task detail page for v2 report fields
10. Add Analyze to NavBar
11. Typecheck + lint

## Environment Variables to Add
```
# BlockRun AI (outgoing x402 payer)
BLOCKRUN_AI_PAYER_KEY=<private key of dedicated AI-spend wallet>
BLOCKRUN_GATEWAY=https://testnet.blockrun.ai        # or https://arc.blockrun.ai for mainnet
BLOCKRUN_NETWORK=eip155:84532                       # or eip155:5042002 for Arc
BLOCKRUN_MODEL=deepseek/deepseek-chat               # or any model from /api/v1/models
```
`BLOCKRUN_AI_PAYER_KEY` is a dedicated testnet wallet key used only for BlockRun inference payments. It must never be exposed to the browser.

## Done When
- [ ] `audit-orchestrator.ts` exports `runAudit(opts)` — runs solc+slither+BlockRun in parallel
- [ ] `provider-worker.ts` has no inline analysis code — delegates entirely to `runAudit()`
- [ ] x402 `POST /api/paid/audit` calls `runAudit()` and returns `AuditReport` v2
- [ ] `AuditReport.schemaVersion === 2` with `score`, `verdict`, `coverage`, `blockrunReceipt`
- [ ] Score ring visible on task detail and Analyze pages
- [ ] Finding cards show `origin` badge (tool/AI/corroborated) and AI exploit/suggestion when present
- [ ] BlockRun receipt with amount and optional tx hash visible in report
- [ ] Typecheck passes with zero errors

## Ready to build?
Switch to Build mode and approve this plan.
