# 2026-05-12 ClickUp Agent Implementation

## Summary

This plan defines the ClickUp-only implementation scope for `clickup_agent_ref` and its Bizbox bridge behavior.

The work is about making the ClickUp adapter semantics correct:

- inbound reply import behavior
- `bridgeBotUserId` vs `clickupAgentUserId`
- archived `agent_thread` bridge cleanup
- ClickUp-specific regression coverage and docs

It is not framed as PR cleanup. The goal is a correct ClickUp adapter implementation with a final PR that contains only ClickUp-specific scope.

## Current State

### Backend bridge work already in progress

- `server/src/services/clickup-bridge.ts` has a pending fix that removes `clickupAgentUserId` as the default inbound author gate.
- The same file has pending cleanup logic to close `agent_thread` bridges when the thread is already archived or becomes unavailable during reply import.
- A legacy fallback is in progress so old configs that stored the posting bot id in `clickupAgentUserId` still suppress loopback comments until the config is resaved correctly.

### Config and UI separation already in progress

- `ui/src/adapters/clickup-agent-ref/config-fields.tsx` now separates `bridgeBotUserId` from `clickupAgentUserId`.
- `packages/adapters/clickup-agent-ref/src/ui/build-config.ts` now persists `bridgeBotUserId` as its own adapter config field.
- `packages/adapters/clickup-agent-ref/src/index.ts` now documents the intended meaning of the two fields.

### Tests and docs already added

- `server/src/__tests__/clickup-bridge.test.ts` now covers the changed import semantics and archived thread bridge closure.
- `packages/adapters/clickup-agent-ref/src/ui/build-config.test.ts` now covers the separated config shape.
- `doc/DEVELOPING.md` now includes a short ClickUp bridge note describing the intended semantics and the regression that broke them.

### Non-core changes are still mixed into the branch

The branch still includes dashboard and live-run presentation changes that are not the core ClickUp adapter implementation:

- `server/src/routes/agents.ts`
- `ui/src/components/ActiveAgentsPanel.tsx`
- `ui/src/components/Sidebar.tsx`
- `ui/src/components/Sidebar.test.tsx`

These are branch state, but they are not the primary implementation target for the ClickUp adapter work.

## Target State

### Inbound reply import semantics

- Bizbox imports non-bot ClickUp replies by default.
- `bridgeBotUserId` is only used to suppress Bizbox’s own loopback comments.
- `clickupAgentUserId` is not used as an inbound reply allowlist.

### Correct field semantics

- `bridgeBotUserId` means the ClickUp user id Bizbox uses when posting bridge comments.
- `clickupAgentUserId` means outbound assignee / `@mention` metadata only.
- The configuration UI, config builder, and adapter docs all use those meanings consistently.

### Agent-thread bridge lifecycle

- Archived `agent_thread` bridges close automatically.
- Pollers do not continue running forever against archived or stale threads.
- Stale bridge rows do not keep showing up as live work because the underlying bridge state is cleaned up correctly.

### ClickUp-only PR scope

The final implementation should leave the PR centered on:

- ClickUp bridge runtime behavior
- ClickUp adapter config correctness
- ClickUp-specific regression tests
- ClickUp-specific documentation

If dashboard/sidebar masking changes remain, they should be clearly treated as non-core follow-up scope rather than the main adapter fix.

## Acceptance Criteria

- Inbound polling imports valid non-bot replies without requiring author equality with `clickupAgentUserId`.
- Loopback comments from the Bizbox posting identity are ignored.
- Archived `agent_thread` bridges close instead of polling forever.
- Config UI and stored config distinguish `bridgeBotUserId` from `clickupAgentUserId`.
- ClickUp adapter docs state the corrected semantics plainly.
- The final PR reads as ClickUp adapter implementation work, not PR-management work.
