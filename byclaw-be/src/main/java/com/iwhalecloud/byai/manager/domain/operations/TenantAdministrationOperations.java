package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminMemberService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminOrganizationService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService.TenantListFilter;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService.TenantView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDatasourceService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDeletionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Set;

/**
 * 在已有服务令牌认证后复用主站租户服务，禁止浏览器选择内部执行账号。
 * @author Codex
 * @since 2026-10-31
 */
@Service
public class TenantAdministrationOperations {
    @Value("${hacu.operations.tenant-admin-user-code:adminvip}")
    private String tenantAdminUserCode;

    @Autowired
    private SandboxUserContextRunner sandboxUserContextRunner;

    @Autowired
    private TenantAdminTenantService tenantAdminTenantService;

    @Autowired
    private TenantAdminMemberService tenantAdminMemberService;

    @Autowired
    private TenantAdminOrganizationService tenantAdminOrganizationService;

    @Autowired
    private TenantDatasourceService tenantDatasourceService;

    @Autowired
    private TenantDbProvisioningService tenantDbProvisioningService;

    @Autowired
    private TenantDeletionService tenantDeletionService;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 仅供经过 OperationsAuthentication 的服务入口调用，不修改主站登录鉴权。
     * @param resource 固定租户模块
     * @param operation 白名单操作
     * @param payload 业务参数及版本、原因
     * @return 与主站相同的业务投影，ID 转为字符串
     */
    public JsonNode execute(String resource, String operation, JsonNode payload) {
        Set<String> allowed = "tenant-admin".equals(resource)
            ? Set.of("list", "packages", "create", "provision", "delete", "organizations",
                "organization-members", "attach", "add-member")
            : Set.of("tables", "browse", "execute");
        if (resource == null || operation == null
            || !Set.of("tenant-admin", "tenant-datasource").contains(resource)
            || !allowed.contains(operation) || payload == null || !payload.isObject()
            || tenantAdminUserCode == null || tenantAdminUserCode.isBlank()) {
            throw new OperationsFailure("INVALID");
        }
        // 使用服务端配置的真实主站账号；查询不到账号或账号不具备平台角色时拒绝。
        return sandboxUserContextRunner.callAsUser(tenantAdminUserCode, () -> {
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            if (!CurrentUserHolder.isPlatformManager() || currentUserId == null || currentUserId <= 0) {
                throw new OperationsFailure("DENIED");
            }
            return "tenant-admin".equals(resource) ? administer(operation, payload) : datasource(operation, payload);
        });
    }

    /**
     * 复用原租户管理服务，保留原创建策略、配额和组织成员检查。
     * @param operation 管理操作
     * @param payload 原接口参数及审计字段
     * @return 原服务业务结果
     */
    private JsonNode administer(String operation, JsonNode payload) {
        if ("list".equals(operation)) {
            ArrayNode tenants = objectMapper.createArrayNode();
            tenantAdminTenantService.list(new TenantListFilter(optional(payload, "name", 200),
                optional(payload, "createdFrom", 40), optional(payload, "createdTo", 40),
                optional(payload, "sortField", 40), optional(payload, "sortOrder", 10)))
                .forEach(tenant -> tenants.add(view(tenant)));
            return tenants;
        }
        if ("packages".equals(operation)) {
            ArrayNode packages = objectMapper.createArrayNode();
            tenantAdminTenantService.packages().forEach(tenantPackage -> {
                ObjectNode packageView = objectMapper.valueToTree(tenantPackage);
                packageView.put("id", Long.toString(tenantPackage.id()));
                packages.add(packageView);
            });
            return packages;
        }
        if ("create".equals(operation)) {
            requireMutation(payload, "new");
            TenantView tenant = tenantAdminTenantService.create(text(payload, "enterpriseName", 200),
                id(payload, "packageId"), text(payload, "requestId", 64));
            tenantDbProvisioningService.request(Long.parseLong(tenant.enterpriseId()));
            return view(tenant);
        }
        String enterpriseId = Long.toString(id(payload, "enterpriseId"));
        if ("organizations".equals(operation)) {
            return objectMapper.valueToTree(tenantAdminOrganizationService.tree(enterpriseId));
        }
        if ("organization-members".equals(operation)) {
            return objectMapper.valueToTree(tenantAdminOrganizationService.members(enterpriseId,
                text(payload, "orgId", 32), flag(payload, "includeDescendants")));
        }
        TenantView tenant = tenant(enterpriseId);
        requireMutation(payload, revision(tenant));
        if ("provision".equals(operation)) {
            tenantDbProvisioningService.request(Long.parseLong(enterpriseId));
            return objectMapper.getNodeFactory().textNode("ACCEPTED");
        }
        if ("delete".equals(operation)) {
            tenantDeletionService.request(enterpriseId, text(payload, "enterpriseName", 200));
            return objectMapper.getNodeFactory().textNode("ACCEPTED");
        }
        if ("attach".equals(operation)) {
            return objectMapper.valueToTree(tenantAdminOrganizationService.attach(enterpriseId,
                text(payload, "orgId", 32), flag(payload, "includeDescendants"), flag(payload, "addMembers")));
        }
        return objectMapper.valueToTree(tenantAdminMemberService.add(enterpriseId, text(payload, "userCode", 128)));
    }

    /**
     * SQL 仍由原工作台服务校验、连接和执行，不转发数据库凭据。
     * @param operation 数据源操作
     * @param payload 显式企业和查询参数
     * @return 原工作台的有界查询结果
     */
    private JsonNode datasource(String operation, JsonNode payload) {
        long enterpriseId = id(payload, "enterpriseId");
        TenantView tenant = tenant(Long.toString(enterpriseId));
        if (!"READY".equals(tenant.provisionState())) {
            throw new OperationsFailure("CONFLICT");
        }
        if ("tables".equals(operation)) {
            return objectMapper.valueToTree(tenantDatasourceService.tables(enterpriseId));
        }
        int page = page(payload);
        if ("browse".equals(operation)) {
            return objectMapper.valueToTree(tenantDatasourceService.browse(enterpriseId,
                text(payload, "schema", 128), text(payload, "table", 128), page));
        }
        String sql = text(payload, "sql", 100000);
        // 复用服务端词法判断，不能由浏览器的 confirmed 字段决定语句是否需要审计。
        if (TenantDatasourceService.requiresPlatformConfirmation(sql)) {
            requireMutation(payload, revision(tenant));
        }
        return objectMapper.valueToTree(tenantDatasourceService.execute(enterpriseId, sql, page,
            payload.path("confirmed").asBoolean(false)));
    }

    /**
     * 租户状态版本防止在陈旧页面上发起操作；成员配额竞争仍由原服务处理。
     * @param tenant 原租户状态投影
     * @return 稳定的状态版本标识
     */
    private String revision(TenantView tenant) {
        String stateVersion = tenant.enterpriseId() + ":" + tenant.provisionState() + ":"
            + tenant.provisionStage() + ":" + tenant.openedAt();
        return java.util.UUID.nameUUIDFromBytes(stateVersion.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
    }

    /**
     * 附加运营版本，保留主站字段名称和空值含义。
     * @param tenant 原租户投影
     * @return 附加版本后的投影
     */
    private ObjectNode view(TenantView tenant) {
        ObjectNode tenantView = objectMapper.valueToTree(tenant);
        tenantView.put("revision", revision(tenant));
        return tenantView;
    }

    /**
     * 仅根据原服务返回的规范企业标识定位，不从浏览器拼接数据库连接。
     * @param enterpriseId 规范企业标识
     * @return 原服务中的当前租户
     */
    private TenantView tenant(String enterpriseId) {
        return tenantAdminTenantService.list(null).stream()
            .filter(tenant -> enterpriseId.equals(tenant.enterpriseId())).findFirst()
            .orElseThrow(() -> new OperationsFailure("NOT_FOUND"));
    }

    /**
     * 操作原因与版本均必填，不自动重试任何写入。
     * @param payload 写操作参数
     * @param revision 当前状态版本
     */
    private void requireMutation(JsonNode payload, String revision) {
        if (text(payload, "reason", 500).isBlank()) {
            throw new OperationsFailure("INVALID");
        }
        if (!revision.equals(text(payload, "revision", 256))) {
            throw new OperationsFailure("CONFLICT");
        }
    }

    /**
     * 标识保持字符串传输，在 Java 边界检查长整型上限。
     * @param payload 业务参数
     * @param field 标识字段
     * @return 精确长整型主键
     */
    private long id(JsonNode payload, String field) {
        String value = text(payload, field, 19);
        if (!value.matches("[1-9][0-9]{0,18}") || value.length() == 19
            && value.compareTo("9223372036854775807") > 0) {
            throw new OperationsFailure("INVALID");
        }
        return Long.parseLong(value);
    }

    /**
     * 限制列表和命令文本长度，不隐式把对象转换为字符串。
     * @param payload 业务参数
     * @param field 文本字段
     * @param maximum 最大字符数
     * @return 原文本
     */
    private String text(JsonNode payload, String field, int maximum) {
        JsonNode value = payload.path(field);
        if (!value.isTextual() || value.asText().isBlank() || value.asText().length() > maximum) {
            throw new OperationsFailure("INVALID");
        }
        return value.asText();
    }

    /**
     * 可选筛选字段保留空值，与主站筛选契约一致。
     * @param payload 业务参数
     * @param field 筛选字段
     * @param maximum 最大字符数
     * @return 非空筛选值，未填写时返回 null
     */
    private String optional(JsonNode payload, String field, int maximum) {
        JsonNode value = payload.path(field);
        if (value.isMissingNode() || value.isNull() || value.isTextual() && value.asText().isEmpty()) {
            return null;
        }
        return text(payload, field, maximum);
    }

    /**
     * 组织操作不接受字符串形式的真假值。
     * @param payload 业务参数
     * @param field 布尔字段
     * @return 显式布尔值
     */
    private boolean flag(JsonNode payload, String field) {
        if (!payload.path(field).isBoolean()) {
            throw new OperationsFailure("INVALID");
        }
        return payload.path(field).asBoolean();
    }

    /**
     * 有界页码与主站数据源保持一致。
     * @param payload 查询参数
     * @return 有效页码
     */
    private int page(JsonNode payload) {
        JsonNode value = payload.path("page");
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < 1 || value.intValue() > 10000) {
            throw new OperationsFailure("INVALID");
        }
        return value.intValue();
    }
}
