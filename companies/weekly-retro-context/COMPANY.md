---
name: Weekly Retro Context
description: Deterministic weekly context collection for ClickUp and GitHub retrospectives
slug: weekly-retro-context
schema: agentcompanies/v1
version: 0.1.0
license: MIT
authors:
  - name: Adrean Palafox
goals:
  - Gather weekly context from ClickUp and GitHub without manual interpretation
  - Convert evidence into deterministic JSON objects for postmortem and retro use
---

Weekly Retro Context is a clean-slate company package for one job: gather a
strict seven-day slice of ClickUp and GitHub activity, review it for retro
value, and emit a stable list of JSON objects that downstream analysis can use
later.

This company does not try to publish, summarize, or act on the output beyond
producing the structured retro-context payload.

The operating loop is:

1. The weekly routine triggers the data-gatherer.
2. The data-gatherer runs deterministic source collection and normalization.
3. The reviewer checks which items belong in postmortem / retro context and
   adds bounded, evidence-backed insights.
4. A deterministic renderer turns the reviewed material into JSON.
5. A validator checks the final JSON against the company schema.
