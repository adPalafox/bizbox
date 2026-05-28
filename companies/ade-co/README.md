# Ade Co

Ade Co is a startup-style agent company package for building and shipping SaaS/products end-to-end.

It is designed to support a continuous loop across product planning, engineering, QA, design, release, and growth/marketing—while keeping the **human board in the loop at milestone gates**.

## Workflow

- Work arrives from the board as product direction, constraints, or milestone approvals.
- CEO/PM translates direction into a scoped plan and assigns work across functions.
- Engineering + Design iterate in tight loops, with QA validating changes.
- Release/DevOps runs readiness checks and coordinates shipping.
- Marketing + Social produce content and launch campaigns; they measure outcomes and feed back into product priorities.

## Org Chart

| Agent | Title | Reports To | Adapter | Model |
| --- | --- | --- | --- | --- |
| `ceo` | CEO / Product Lead | - | `codex_local` | `gpt-5.4-mini` |
| `tech-lead` | Tech Lead | `ceo` | `codex_local` | `gpt-5.4-mini` |
| `fullstack-dev` | Full-stack Engineer | `tech-lead` | `codex_local` | `gpt-5.4-mini` |
| `qa` | QA / Test Engineer | `tech-lead` | `codex_local` | `gpt-5.4-mini` |
| `designer` | Product Designer (UX/UI) | `ceo` | `codex_local` | `gpt-5.4-mini` |
| `devops-release` | DevOps / Release | `tech-lead` | `codex_local` | `gpt-5.4-mini` |
| `marketing-growth` | Marketing / Growth | `ceo` | `codex_local` | `gpt-5.4-mini` |
| `social-content` | Social Media / Content | `marketing-growth` | `codex_local` | `gpt-5.4-mini` |

## Projects

- `number-line`: Number Line app (repo `https://github.com/adPalafox/number-line`)

## Files

- [`COMPANY.md`](./COMPANY.md) - company metadata and goals
- `agents/*/AGENTS.md` - per-agent instructions and milestone gates
- [`projects/number-line/PROJECT.md`](./projects/number-line/PROJECT.md) - project seed definition
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
