# Split parity probe

The harness/tool-sandbox split is accepted only if a user on the shared DSH host
can do everything a user with their own sandbox can. This directory holds the
checks that compare the two.

## In the sandbox: `probe.sh` and `compare.mjs`

1. Put `probe.sh` where both users' commands can run it (for example in each
   user's `/by`).
2. In a chat as a user with their own sandbox, ask the assistant to run
   `bash /by/probe.sh` and save the output as `before.jsonl`. Do the same as a
   user on the shared host and save `after.jsonl`.
3. `node compare.mjs before.jsonl after.jsonl --ignore-env GH_TOKEN,DWS_HOME`
   lists every check whose outcome differs (exit status 1), or reports parity.
   `--ignore-env` names variables that come from the users' own private
   parameters and differ by user, not by deployment.

`home-marker-kept` needs two runs: run the probe, let the tool sandbox be
released (it is after its idle period, or release it through BE's
`/sandbox/removeSandbox`), run it again.

## Outside the sandbox

These go through the frontend, BE or the host and are checked by hand (or by
the deployment's own browser automation), the same way for both users:

| Check | How | Parity means |
|---|---|---|
| Account login navigation | `POST /byaiService/sandbox/browser/navigate` with the user's token, the sandbox carrying the browser and an `https` URL | `success: true` for both |
| Recorder | `GET /byaiService/recorder/health` with the user's token | `daemon` and `extension` ok for both |
| Remote desktop | open the browser desktop from the chat | the assistant's browser is shown for both |
| Generated media | ask for `image_generate` with a working image model | the image appears in the session's files for both |
| CodeGraph | ask the assistant to use `mcp__codegraph__codegraph_explore` | available for both |
| Instruction files | in one session: a first turn, then write an `AGENTS.md` into the session directory, release the tool sandbox, then ask a question it answers without tools | the second answer follows the file for both; on the shared host that turn starts the tool sandbox and reads the file there |
| Model-only turn | a turn that uses no tool, after the tool sandbox was released | the shared host starts the tool sandbox for the turn (its instruction files and Skills are read there); logging in alone does not |
| Services started by the user | start a server on a port in the sandbox, open `/v1/sandboxes/<id>/proxy/<port>/` | reachable for both |
