---
name: retro-context-curation
description: Deterministic weekly retro context selection, review, and JSON shaping rules
metadata:
  paperclip:
    purpose: weekly-retro-context
---

# Retro Context Curation

Use this skill when deciding whether collected weekly evidence should be kept
for a retro or postmortem conversation and when shaping the final structured
output.

## Inputs

You receive:

- a strict seven-day evidence window
- normalized ClickUp items
- normalized GitHub pull request items
- the company topic taxonomy
- a JSON review template

## Rules

1. Keep only evidence that is materially useful for a weekly retro or
   postmortem.
2. Prefer concrete observations over broad summaries.
3. Do not invent causes, outcomes, or people who are not present in the source
   data.
4. Use the configured topic taxonomy first; fall back to `general-context` if a
   piece of evidence does not fit a more specific topic.
5. A topic should only be included when the evidence is strong enough to make
   a useful conversation starter.
6. Insights must stay short and evidence-backed.
7. Preserve participant names and source references exactly as they appear in
   the normalized input.

## Output Contract

The reviewer produces a review JSON file shaped like the company review
template:

- `window`
- `decisions[]`
  - `topic_slug`
  - `topic_label`
  - `include`
  - `evidence_ids[]`
  - `insights[]`
  - `review_notes`

The final renderer converts the approved decisions into the company output
template, which is a list of JSON objects.

## Working Style

- Reject off-topic items instead of forcing them into a topic bucket.
- Avoid rewriting evidence into something more polished than it is.
- Add only short insights that a human can use to drive the conversation.
- When uncertain, prefer exclusion over speculative inclusion.
