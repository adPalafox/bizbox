# Ade Co

Ade Co is a barebones agent company package for Codex-local task automation and setup work.

It is intentionally minimal: one root company, one CEO/setup lead agent, no projects, and no starter tasks. The goal is to keep the package easy to import, export, and extend later without adding unnecessary structure up front.

## Workflow

- Work comes in from the board as setup requests, automation ideas, or package changes.
- The CEO/setup lead turns that work into concrete package edits, automation setup, or follow-up tasks.
- If the work grows beyond a single role, the next step is to add a new agent rather than overloading the skeleton.

## Org Chart

| Agent | Title | Reports To | Adapter | Model |
| --- | --- | --- | --- | --- |
| CEO | Chief Executive Officer | - | `codex_local` | `gpt-5.4-mini` |

## Files

- [`COMPANY.md`](./COMPANY.md) - company metadata and goals
- [`agents/ceo/AGENTS.md`](./agents/ceo/AGENTS.md) - the single setup lead agent
- [`.paperclip.yaml`](./.paperclip.yaml) - portable Codex-local runtime details

## Importing

Use the current CLI import flow from the package root:

```sh
paperclipai company import ./companies/ade-co
```

To import into a new company name:

```sh
paperclipai company import ./companies/ade-co --target new --new-company-name "Ade Co"
```

## References

- [Agent Companies specification](https://agentcompanies.io/specification)
- [Paperclip](https://github.com/paperclipai/paperclip)
