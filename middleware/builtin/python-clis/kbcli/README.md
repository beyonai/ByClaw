# kbcli

`kbcli` is the service-discovered knowledge-base client used by ByClaw skills.
It exposes the `kbcli` command and resolves platform services through
`by_framework`; it does not accept arbitrary service endpoints.

See `DESIGN.md` for the runtime contract and `examples/` for an Agent Skill
integration example.

## Development

```sh
python -m pip install "by-framework==0.2.2.dev10" -e .
python -m unittest discover -s tests
kbcli --help
```
