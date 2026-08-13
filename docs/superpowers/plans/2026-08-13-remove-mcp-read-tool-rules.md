# Remove MCP Read Tool Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `BYAI_MCP_READ_TOOL_RULES` and temporarily classify every discovered MCP tool as `READ`.

**Architecture:** Make discovery own the temporary default classification and remove the administrator rule component. Keep the gateway's snapshot enforcement so the execution boundary remains stable for future policy restoration.

**Tech Stack:** Java 17, Spring Boot, JUnit 5, Mockito, PostgreSQL migration SQL, Markdown.

---

### Task 1: Drive the new discovery default with a failing test

**Files:**
- Modify: `byclaw-be/src/test/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpToolDiscoveryServiceTest.java`

- [x] Rename the discovery test to describe the `READ` default and assert both captured snapshots and returned views contain `READ`.
- [x] Assert captured snapshots use `SYSTEM_DEFAULT` as their risk source.
- [x] Run `rtk mvn -B -f byclaw-be/pom.xml -Dtest=UserMcpToolDiscoveryServiceTest test` and verify it fails because the current implementation returns `UNKNOWN`.

### Task 2: Remove the rule component and default discovery to READ

**Files:**
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpToolDiscoveryService.java`
- Delete: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpToolRiskPolicy.java`
- Delete: `byclaw-be/src/test/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpToolRiskPolicyTest.java`

- [x] Remove `UserMcpToolRiskPolicy` constructor injection and assign `READ/SYSTEM_DEFAULT` directly when building snapshots and views.
- [x] Delete the unused component and its parameter-focused tests.
- [x] Run the focused discovery and gateway tests and verify they pass.

### Task 3: Remove persistence configuration and align schema defaults

**Files:**
- Modify: `deploy/migrations/versions/V0.4.0/V0.4.0__ddl.sql`
- Modify: `deploy/migrations/versions/V0.4.0/V0.4.0__dml.sql`
- Modify: `deploy/middleware/initdb/02_ddl.sql`
- Modify: `deploy/middleware/initdb/04_dml.sql`
- Modify: `byclaw-be/src/test/java/com/iwhalecloud/byai/manager/connector/ConnectorSchemaTest.java`

- [x] Change the tool snapshot schema default from `UNKNOWN` to `READ` in both DDL sources.
- [x] Remove the parameter inserts and add an idempotent delete for `BYAI_MCP_READ_TOOL_RULES` in both DML sources.
- [x] Add schema assertions proving the READ default and absence of a parameter seed, then run `ConnectorSchemaTest`.

### Task 4: Update documentation and verify

**Files:**
- Modify: `docs/architecture/user-mcp-self-service-design.md`

- [x] Replace the administrator rule description with the explicitly temporary all-READ policy and its security warning.
- [x] Scan for obsolete parameter and policy references.
- [x] Run `rtk mvn -B -f byclaw-be/pom.xml verify`.
- [x] Run migration merge dry-run and `rtk proxy git diff --check`.
- [x] Consolidate the branch into one Conventional Commit, fast-forward `develop`, then delete the worktree and branch.
