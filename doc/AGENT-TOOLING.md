# Agent Tooling (Codex / Cursor / Composer)

This document explains how we keep agent configuration aligned across tools.

## Source of truth

- Repo contract: `AGENTS.md`
- Repo-native change loop: `doc/CODEX-WORKFLOW.md` (applies to any coding agent)
- Dev commands and policies: `doc/DEVELOPING.md`

Cursor/Composer reads repo-local rules from `.cursor/rules/` (mirrors the same intent as `AGENTS.md` + `doc/CODEX-WORKFLOW.md`).

## What is portable vs tool-specific

### Portable (in-repo)

- **Workflow + invariants**: `AGENTS.md`, `doc/CODEX-WORKFLOW.md`
- **Shared skills**: `skills/` (these are intended to be tool-agnostic)

### Tool-specific (per-user / per-tool)

- **Codex global config**: typically under `~/.codex/` (model defaults, plugins, MCP server registrations, and allow/approve rules)
- **Cursor settings**: user settings, MCP enablement, and any per-user rules

We do not commit user-level secrets or per-user tool state into this repo.

## Cursor/Composer setup in this repo

Repo-local Cursor rules live in:

- `.cursor/rules/00-repo-contract.mdc`
- `.cursor/rules/10-change-loop.mdc`
- `.cursor/rules/20-verification-and-policy.mdc`
- `.cursor/rules/30-skills-and-where-they-live.mdc`

These are intentionally **minimal** and **additive**. If you update contributor policy, update `AGENTS.md` / `doc/*` first, then mirror the delta into `.cursor/rules/`.

## MCP notes (what to port manually)

Your Codex config may define MCP servers (for example `context7`, `codebase_memory`, etc.) in `~/.codex/config.toml`.

Cursor MCP server configuration is **per-user**. To mirror a Codex MCP server into Cursor:

- Use Cursor’s MCP configuration UI to add the same server `command` + `args`
- Keep any approval requirements consistent with your trust model
- Avoid committing machine-specific absolute paths into the repo (prefer `npx -y <pkg>` style commands when possible)

## Recommended workflow for contributors

- Start from `AGENTS.md` and follow the docs order.
- Use `skills/` when you need a reusable operational playbook.
- Before shipping a change, run the smallest meaningful verification (`pnpm test` by default) and call out anything you did not run.

