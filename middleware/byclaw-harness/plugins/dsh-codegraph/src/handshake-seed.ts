/**
 * What CodeGraph 1.6.0 answers to the MCP handshake of the default server command
 * (`codegraph serve --mcp`, tools `explore`), captured from that server. A context
 * registers the tool from this before any server has run, so its start never starts
 * the tool sandbox. A server that introduces itself differently replaces it in the
 * cache; `verify:runtime` fails the image build when the installed CodeGraph no
 * longer gives these answers.
 */
export const HANDSHAKE_SEED_VERSION = '1.6.0'

export const HANDSHAKE_SEED: Readonly<Record<string, { result: unknown } | { error: unknown }>> = {
  "server/discover": {
    "error": {
      "code": -32601,
      "message": "Method not found: server/discover"
    }
  },
  "initialize": {
    "result": {
      "protocolVersion": "2024-11-05",
      "capabilities": {
        "tools": {}
      },
      "serverInfo": {
        "name": "codegraph",
        "version": "1.6.0"
      },
      "instructions": "# Codegraph — available (per-project; pass projectPath)\n\nCodegraph is a SQLite knowledge graph of a codebase's symbols, edges, and\nfiles (30+ languages): one `codegraph_explore` call returns the verbatim, line-numbered source\nof the relevant symbols PLUS the call paths between them and a blast-radius\nsummary — replacing a grep + Read loop with one round-trip.\n\nThis server started somewhere with no `.codegraph/` of its own, so there is no\ndefault project — but the tools are available and work **per project**:\n\n- To query a project that HAS a `.codegraph/` index (e.g. a service inside a\n  monorepo, or a second repo), pass its path as `projectPath` to\n  `codegraph_explore` (and any other codegraph tool). Codegraph resolves the\n  nearest `.codegraph/` at or above that path and answers from it — for as many\n  projects as you like in one session.\n- For a project with no `.codegraph/`, use your built-in tools (Read/Grep/Glob)\n  for that project. Indexing is the user's decision — don't run it yourself, but\n  if it comes up they can run `codegraph init` in a project to enable codegraph\n  there (a new index is picked up live, no restart).\n\n\n---\nCodeGraph v1.6.2 is available (this server is running v1.6.0). Update with `codegraph upgrade`. This server keeps running the old version until the user upgrades — mention it when convenient; do not run the upgrade yourself."
    }
  },
  "tools/list": {
    "result": {
      "tools": [
        {
          "name": "codegraph_explore",
          "description": "PRIMARY TOOL — call FIRST for almost any question OR before an edit: how does X work, architecture, a bug, where/what is X, surveying an area, or the symbols you are about to change. Returns the verbatim source of the relevant symbols grouped by file in ONE capped call (Read-equivalent — treat the shown source as already Read; do NOT re-open those files), plus the call path among them. Query can be a natural-language question OR a bag of symbol/file names. Usually the ONLY call you need — more accurate context, in far fewer tokens and round-trips than a search/Read/Grep loop.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "query": {
                "type": "string",
                "description": "Symbol names, file names, or short code terms to explore (e.g., \"AuthService loginUser session-manager\", \"GraphTraverser BFS impact traversal.ts\"). For a flow question, name the symbols spanning the flow (e.g. \"mutateElement renderScene\"). A natural-language question works too — no prior codegraph_search needed."
              },
              "maxFiles": {
                "type": "number",
                "description": "Maximum number of files to include source code from (default: 12)",
                "default": 12
              },
              "projectPath": {
                "type": "string",
                "description": "Absolute path to the project to query (or any directory inside it) — codegraph uses the nearest .codegraph/ index at or above that path. Omit to use this session's default project. Pass it to query a second codebase, or when the server root has no index of its own (e.g. a monorepo where only sub-projects are indexed, so there is no default project)."
              }
            },
            "required": [
              "query",
              "projectPath"
            ]
          },
          "annotations": {
            "readOnlyHint": true,
            "destructiveHint": false,
            "idempotentHint": true,
            "openWorldHint": false
          }
        }
      ]
    }
  }
}
