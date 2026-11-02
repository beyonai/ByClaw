# dbcli

`dbcli` is the session-scoped SQL execution runtime used by ByClaw skills. It
discovers authorized database resources through `by_framework` and exposes the
`dbcli` command.

See `DESIGN.md` for the execution and policy contract and `examples/` for a
transactional account-transfer example.

## Development

```sh
python -m pip install "by-framework==0.2.2.dev10" -e ".[all]"
python -m unittest discover -s tests
dbcli --help
```
