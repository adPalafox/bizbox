# Scripts

These scripts are intended to run in order:

1. `collect_weekly_context.py`
2. `normalize_weekly_context.py`
3. `render_weekly_context_json.py`
4. `validate_weekly_context_json.py`

The scripts are deterministic and can also run against the fixture files in
`../fixtures/` for local verification.

Example:

```bash
python3 scripts/collect_weekly_context.py \
  --config config/weekly-retro-context.json \
  --clickup-file fixtures/clickup.sample.json \
  --github-file fixtures/github.sample.json \
  --output /tmp/weekly-retro.raw.json
```
