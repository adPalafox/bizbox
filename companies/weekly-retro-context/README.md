# Weekly Retro Context

Weekly Retro Context is a clean-slate company package for collecting weekly
context from ClickUp and GitHub and turning it into deterministic JSON records
for retrospectives and postmortems.

## Workflow

This company runs in a narrow pipeline:

1. `data-gatherer` wakes up on the weekly schedule.
2. The gatherer runs deterministic Python scripts to collect and normalize
   ClickUp and GitHub evidence strictly within the prior seven-day window.
3. `reviewer` checks the normalized evidence, keeps only what is useful for
   retro/postmortem context, and adds bounded insights that are directly
   supported by the evidence.
4. A deterministic renderer writes the final JSON list.
5. A validator checks the output shape against the company schema.

The pipeline stops there for now. There is no downstream publishing step.

## Org Chart

| Agent | Title | Reports To | Skills |
| --- | --- | --- | --- |
| `data-gatherer` | Data Gatherer / Coordinator | - | `paperclip`, `retro-context-curation` |
| `reviewer` | Retro Reviewer | `data-gatherer` | `paperclip`, `retro-context-curation` |

## Roles

- `data-gatherer` runs the collection scripts, keeps the weekly window strict,
  and hands the normalized bundle to the reviewer.
- `reviewer` decides whether a topic or item is actually useful for a weekly
  retro or postmortem conversation, and can add short insights that stay tied
  to evidence.

## Package Layout

- `config/` - company-specific source selectors and topic taxonomy
- `fixtures/` - sample raw inputs and review files for local verification
- `projects/` - the weekly retro context project and recurring task seed
- `schemas/` - JSON schemas for the review and final output
- `scripts/` - deterministic collectors, normalizers, renderers, and validators
- `skills/` - company-local skill that defines the curation rules and output template

## Getting Started

Import the company package:

```bash
paperclipai company import ./companies/weekly-retro-context
```

Apply the weekly routine after import:

```bash
./companies/weekly-retro-context/scripts/apply-routines.sh \
  --company-id "<COMPANY_ID>" \
  --paperclip-url "http://localhost:3100"
```

The routine runs every Wednesday at 9am in the configured timezone and
collects only the previous seven days of activity.

## References

- [Agent Companies specification](https://agentcompanies.io/specification)
- [Paperclip](https://github.com/paperclipai/paperclip)
