# Commands

Public entry:

```bash
python scripts/run.py QUERY \
  --from-date YYYY-MM-DD \
  --to-date YYYY-MM-DD \
  --domain example.com \
  --handle example
```

`--domain` and `--handle` may be repeated. The example forwards them as `--allow-domain` and `--allow-handle` to one
`groksearchcli research run` process.

Successful stdout is the normalized CLI JSON envelope. Read `data.answer` and `data.citations`; do not assume raw result
arrays exist. Any nonzero exit, invalid JSON, or `ok: false` is a failed Skill run.
