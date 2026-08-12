# Source Strategy

Search ClawHub, Skills.sh, FindSkills.cn, Smithery Skill/MCP, Glama MCP, and GitHub as an unverified fallback. Search all enabled sources concurrently by default; support source and type filters; allow 8 seconds per source and 20 seconds total; return partial results with a full coverage report.

For routed website execution, use the byCLI-first path: `bycli list -f json` dynamic discovery, then a dedicated adapter, then a byCLI search-engine `site:` query, then byCLI web read or `bycli browser`, then a manual link. Never use direct curl, fetch, or browser bypass after routing to byCLI. The manual-link fallback only returns a link for user action and never opens it through another browser executor.

GitHub-only candidates remain unverified and outside the default Top 10. Keep search and installation separate.
