# User MCP Connector Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage multiple user-owned MCP service instances inside the existing connector configuration Drawer, with instance-level status and safe editing/configuration semantics.

**Architecture:** Keep `user-mcp` as one system connector template and load its user-owned resource instances through `/connector/mcp-services`. The backend returns instance authorization state in one batch, connection-identity edits invalidate only that instance, and MCP operational policy is read dynamically from system parameter management while the encryption key remains a deployment secret.

**Tech Stack:** Spring Boot 3, MyBatis/OpenGauss, JUnit 5/Mockito, React/Umi Max, Ant Design, Jest/Testing Library.

---

### Task 1: Instance status read model and edit semantics

**Files:**
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/usermcp/UserMcpServiceDto.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/connector/ConnectorAuthMapper.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpServiceFacade.java`
- Test: `byclaw-be/src/test/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpServiceFacadeTest.java`

- [x] Add failing tests proving two MCP resources receive independent batched authorization states.
- [x] Add a failing test proving metadata-only edits preserve revision and active authorization.
- [x] Add a failing test proving endpoint/auth changes increment revision and set only that instance to `REAUTH_REQUIRED`.
- [x] Implement one batch authorization query keyed by `resourceId`, extend the DTO with `enableFlag`, `credentialState`, `connected`, and `lastVerifiedAt`, and remove list-path N+1 extension reads.
- [x] Split update behavior by fingerprint equality; reject `resourceCode` changes, preserve bindings for metadata-only edits, and invalidate bindings for connection-identity edits.
- [x] Run `rtk mvn -B -f byclaw-be/pom.xml -Dtest=UserMcpServiceFacadeTest test`; expect zero failures.

### Task 2: Dynamic MCP administration parameters

**Files:**
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/usermcp/McpEndpointPolicy.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpToolRiskPolicy.java`
- Modify: `byclaw-be/config/application.properties`
- Modify: `.env.example`
- Modify: `deploy/migrations/versions/V0.4.0/V0.4.0__dml.sql`
- Modify: `deploy/middleware/initdb/04_dml.sql`
- Test: `byclaw-be/src/test/java/com/iwhalecloud/byai/manager/domain/usermcp/McpEndpointPolicyTest.java`
- Test: `byclaw-be/src/test/java/com/iwhalecloud/byai/manager/domain/usermcp/UserMcpToolRiskPolicyTest.java`

- [x] Add failing tests that change `BYAI_MCP_ALLOWED_ADDRESSES` and `BYAI_MCP_READ_TOOL_RULES` through a mocked `SystemConfigService` between calls and observe the new policy without reconstructing the component.
- [x] Inject `SystemConfigService` and read both parameter values at decision time so cache refresh makes changes effective without application restart.
- [x] Seed both parameter codes idempotently in V0.4.0 and initialization DML.
- [x] Remove their environment/application-property mappings; retain only `BYAI_MCP_CREDENTIAL_KEY` as a deployment secret.
- [x] Run the two policy test classes; expect zero failures.

### Task 3: Nested MCP management in Connector Drawer

**Files:**
- Create: `byclaw-fe/src/components/QueryInput/components/ConnectorControl/UserMcpManager.tsx`
- Create: `byclaw-fe/src/components/QueryInput/components/ConnectorControl/UserMcpManager.test.tsx`
- Modify: `byclaw-fe/src/components/QueryInput/components/ConnectorControl/index.tsx`
- Modify: `byclaw-fe/src/components/QueryInput/components/ConnectorControl/index.module.less`
- Modify: `byclaw-fe/src/components/QueryInput/components/ConnectorControl/__tests__/index.test.tsx`
- Delete: `byclaw-fe/src/pages/mcpServices/index.tsx`
- Delete: `byclaw-fe/src/pages/mcpServices/index.module.less`
- Modify: `byclaw-fe/config/route.config.ts`
- Modify: `byclaw-fe/src/locales/en-US.ts`
- Modify: `byclaw-fe/src/locales/zh-CN.ts`

- [x] Add failing component tests proving multiple MCP instances render, the template exposes “管理” rather than the generic switch, and each instance toggles with its own `resourceId`.
- [x] Move the existing form and CRUD behavior into `UserMcpManager`, add instance status rendering and confirmation for connection-identity edits while enabled.
- [x] Render `UserMcpManager` under the `user-mcp` template inside the existing configuration Drawer and exclude the template from generic authorize/enable/revoke actions.
- [x] Remove the standalone route, menu labels, and page files.
- [x] Run scoped Jest, ESLint, Stylelint, and Prettier checks; expect zero errors.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/architecture/user-mcp-self-service-design.md`

- [x] Document metadata-only editing, automatic disable/reauthorization for identity changes, dynamic admin parameters, and deployment-secret ownership of the encryption key.
- [x] Run `rtk git diff --check` and scan for obsolete `/mcpServices`, application-property mappings, and V0.6.1 migration references.
- [x] Run `rtk mvn -B -f byclaw-be/pom.xml verify`.
- [x] Run frontend scoped lint/format checks, `rtk pnpm run test`, and `rtk pnpm run build` from `byclaw-fe`.
- [x] Keep the whole reset feature as one final Conventional Commit only after user-approved documentation is ready to stage.
