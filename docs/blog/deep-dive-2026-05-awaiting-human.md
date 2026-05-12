---
title: "Deep Dive: The `awaiting_human` Status — Rethinking Agent-Human Handoff in Bizbox"
date: 2026-05-12
slug: deep-dive-awaiting-human-status
author: Citro Bizbox Team
channels: [github, discourse, devto, x]
---

# Deep Dive: The `awaiting_human` Status — Rethinking Agent-Human Handoff in Bizbox

*May 2026*

## The Problem: When "Blocked" Means Two Different Things

For the first few months of Bizbox, we used a single `blocked` status to mean "this issue can't move forward right now." Simple enough. But as our agent routines grew more sophisticated, we hit a pattern that kept causing friction:

**Some blocked issues need an AI agent to unstick them. Others need a human.**

When an issue is waiting on a dependency—another task to complete, an external API to respond, a CI pipeline to finish—that's work another AI agent *could* help with. Maybe a reconciler can auto-assign the blocker, or a monitoring routine can check if the condition cleared.

But when an issue is waiting on a *human decision*—"Should we proceed with this plan?" or "Which option do you prefer?"—those are fundamentally different. An AI agent stepping in to "unstick" a decision the board is still weighing breaks the execution contract.

The `blocked` status was doing double duty, and it meant our reconciler logic had to choose: either ignore *all* blocked work (and miss real unblocking opportunities), or risk auto-claiming issues that humans had explicitly parked for review.

We chose to split the concept.

**[PR #33: Add `awaiting_human` issue status](https://github.com/zesthq/bizbox/pull/33)** landed on May 8, 2026, introducing a new status and tightening the semantics of the existing one.

---

## The Design: Two Flavors of Waiting

Here's how we now distinguish parked work:

### `blocked`
- **Meaning:** Waiting on another issue, external system, or dependency.
- **Who can unstick it:** Other AI agents, automated workflows, or the blocking condition clearing.
- **Reconciler behavior:** May auto-assign or auto-wake when the blocker resolves.

### `awaiting_human`
- **Meaning:** Waiting on a human or board decision, answer, or informal confirmation.
- **Who can unstick it:** Only the board (or the owning user-assignee).
- **Reconciler behavior:** Explicitly excluded—agents must not auto-claim or transition out of this status.

The third status, `in_review`, remains unchanged—it still covers formal execution-policy signoff gates, which are a separate control.

---

## Implementation: Where It Touches

This wasn't just a database enum tweak. The `awaiting_human` status flows through the whole system:

### Auto-Park Triggers

When an agent creates an interaction of type `ask_user_questions` or `request_confirmation` on an `in_progress` issue, we now **auto-park the issue to `awaiting_human`** immediately. This prevents the agent from continuing to act on the issue while a human response is pending.

Interactions created by board users (not agents) don't trigger auto-park—those are considered collaborative edits, not blocking questions.

Here's the relevant logic from `services/issue-thread-interactions.ts`:

```typescript
// Auto-park to awaiting_human when an agent asks a question or requests confirmation
if (
  (kind === 'ask_user_questions' || kind === 'request_confirmation') &&
  interaction.createdByAgentId &&
  issue.status === 'in_progress'
) {
  await issueStore.update(issueId, { status: 'awaiting_human' });
}
```

### Reconciler Exclusion

The heartbeat reconciler—which auto-assigns unowned blocking issues—now explicitly skips `awaiting_human`. That's enforced in `services/heartbeat.ts`:

```typescript
const eligibleStatuses = ['todo', 'blocked']; // NOT awaiting_human
```

### Wake-Reason Filtering

When a cron wake or external event tries to auto-checkout an issue, we now allow `awaiting_human` *only* when the wake reason indicates genuine human action: `issue_commented`, `issue_reopened_via_comment`, `interaction_resolved`, or `approval_approved`.

Other wake reasons (like `scheduled` or `dependency_unblocked`) will skip `awaiting_human` issues, because those wakes are system-driven, not human-driven.

### Agent Mutation Guards

Agents can *set* an issue to `awaiting_human` (useful when they detect a blocker they can't resolve), but they **cannot transition out of it**. That's enforced via a 403 response in `routes/issues.ts`:

```typescript
if (
  existingIssue.status === 'awaiting_human' &&
  body.status !== 'awaiting_human' &&
  req.auth.principalType === 'agent'
) {
  return res.status(403).json({
    error: 'Agents may not transition issues out of awaiting_human status'
  });
}
```

Board users and the owning user-assignee can still move the issue forward.

### UI Changes

The status shows up in the Kanban board between `in_review` and `blocked`, rendered in an amber/orange palette (distinct from the red `blocked`). The dashboard now surfaces a separate `tasks.awaitingHuman` counter so operators can see at a glance how many issues are parked waiting on them.

---

## Why This Matters

The split solves three concrete problems we were hitting in production:

1. **Reconciler Safety:** The auto-assignment logic can now confidently act on `blocked` work without risking stepping on human decision-making.

2. **Agent Clarity:** When an agent routine wakes up and sees a `blocked` issue, it knows it's allowed to help. When it sees `awaiting_human`, it knows to leave it alone.

3. **Board Visibility:** Operators get a clean signal: the `awaiting_human` counter is the queue of issues that need *their* attention. The `blocked` counter is work the system might auto-resolve.

---

## Trade-Offs and Open Questions

### The Overload Risk

We now have *three* parked states (`blocked`, `awaiting_human`, `in_review`), and the boundaries aren't always obvious. For example:

- What if an issue is both dependency-blocked *and* waiting on a human decision?
- Should `awaiting_human` support a `blockedByIssueIds` array, or is that mixing concepts?

Right now, the answer is: **pick the strongest constraint.** If a human needs to weigh in, use `awaiting_human` even if there's also a dependency blocker. The agent can't act either way, so the human-block is the active gate.

We're open to feedback on whether that heuristic holds as routine complexity grows.

### Auto-Park Scope

We currently auto-park only for `ask_user_questions` and `request_confirmation` interactions. Other interaction kinds—like `suggest_tasks`—don't trigger auto-park, because those are seen as proposals the board can act on asynchronously without blocking the agent.

Is that the right line? Maybe. We're watching for cases where an agent leaves a "what should I do?" interaction and then keeps working, which would suggest we need to widen the auto-park net.

### External Consumers

If you're building on Bizbox or consuming our issue API, note that the status enum just expanded. The canonical list lives in `packages/shared/src/constants.ts` (`ISSUE_STATUSES`). Hard-coded status checks in external tooling will need an update.

---

## What's Next

The `awaiting_human` status shipped in [v0.0.11](https://github.com/zesthq/bizbox/releases/tag/v0.0.11) on May 8, 2026. We're already seeing cleaner reconciler behavior and fewer "why did the agent touch this?" support questions.

But we're still learning:

- Do we need a separate `awaiting_external` for third-party API blockers that aren't agent-unblockable but also aren't human decisions?
- Should the UI show *why* an issue is `awaiting_human`—like surfacing the unresolved interaction inline?
- How does this interact with approval workflows when those land?

If you're running Bizbox in production, we'd love to hear how the new status fits (or doesn't fit) your workflows. Drop a note in [GitHub Discussions](https://github.com/zesthq/bizbox/discussions) or on [Discourse](https://bizboxai.discourse.group).

---

## Related Work

- **[PR #33: Add `awaiting_human` issue status](https://github.com/zesthq/bizbox/pull/33)** — full implementation and test coverage
- **[PR #38: Human handoff logging and notifications](https://github.com/zesthq/bizbox/pull/38)** — ClickUp notification integration for `awaiting_human` transitions
- **[Execution Semantics doc](https://github.com/zesthq/bizbox/blob/master/doc/execution-semantics.md)** — updated status definitions

---

**About Bizbox:** We're building an AI-native task orchestration system where humans and AI agents collaborate on structured work. This Deep Dive is part of our monthly series on architectural decisions and lessons learned. [Follow the project on GitHub.](https://github.com/zesthq/bizbox)
