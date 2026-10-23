package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInventory;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxReleaseException;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.operations.OperationsSandboxMapper;
import com.iwhalecloud.byai.manager.vo.operations.OperationsSandboxVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** 复用现有生命周期能力与租户查询通道；不增加停用策略。
 * @author Codex
 * @since 2026-10-23
 */
@Service
public class PlatformOperationsService {
    @Autowired
    private OperationsSandboxMapper records;
    @Autowired
    private SandboxRuntimeInventory inventory;
    @Autowired
    private SandboxService sandboxes;
    @Autowired
    private SandboxUserContextRunner userContext;
    @Autowired
    private TenantDbProvisioningService tenants;
    @Autowired
    private TenantNodeClient nodes;
    @Autowired
    private ObjectMapper json;

    /** 固定资源与操作集合，操作人和请求号必须由可信 HACU 服务提供。 */
    public JsonNode execute(JsonNode request) {
        if (request == null || !request.isObject()
            || text(request, "actor", 128).isBlank()
            || !text(request, "requestId", 128).matches("[a-zA-Z0-9:_-]{1,128}")
            || !request.path("payload").isObject()) {
            throw new OperationsFailure("INVALID");
        }
        JsonNode payload = request.path("payload");
        String resource = text(request, "resource", 32);
        String operation = text(request, "operation", 32);
        if ("groups".equals(resource)) {
            return groups(operation, payload);
        }
        if (!"sandboxes".equals(resource)) {
            throw new OperationsFailure("INVALID");
        }
        if ("list".equals(operation)) {
            return list(payload);
        }
        OperationsSandboxVo record = requireRecord(id(payload, "id"));
        if ("detail".equals(operation)) {
            return view(record, inventory.current(), Instant.now().toString());
        }
        if (!Set.of("start", "release", "restart").contains(operation)
            || text(payload, "reason", 500).isBlank()) {
            throw new OperationsFailure("INVALID");
        }
        if (!revision(record).equals(text(payload, "revision", 128)) || !can(record, operation)) {
            throw new OperationsFailure("CONFLICT");
        }
        if ("start".equals(operation) && hasActiveRuntime(record, inventory.current())) {
            throw new OperationsFailure("CONFLICT");
        }
        // CAS 消费版本，网络调用不在 JDBC 事务内，重复提交不能重放同一版本。
        if (records.claim(record, operation) != 1) {
            throw new OperationsFailure("CONFLICT");
        }
        if ("start".equals(operation)) {
            SandboxLaunchData launched = userContext.callAsUser(record.getUserCode(), () -> {
                if (record.getResourceId() != null && record.getResourceId() > 0) {
                    return sandboxes.launchSandbox(record.getUserCode(), record.getResourceId());
                }
                return sandboxes.launchSandboxWithServiceKey(record.getUserCode(), launchServiceKey(record));
            });
            // 既有启动服务以 null 表示明确失败，不能继续生成受理回执。
            if (launched == null) {
                throw new OperationsFailure("FAILED");
            }
        } else if ("release".equals(operation)) {
            try {
                sandboxes.removeSandboxById(record.getId());
            } catch (SandboxReleaseException failure) {
                throw new OperationsFailure(failure.isOutcomeUnknown() ? "UNKNOWN" : "RELEASE_FAILED");
            }
            // 既有 void 接口在 CAS 丢失时可能直接返回，不能把未完成的释放当作受理成功。
            if (!"RELEASED".equals(requireRecord(record.getId()).getStatus())) {
                throw new OperationsFailure("UNKNOWN");
            }
        } else {
            tenants.requestRestart(record.getEnterpriseId(), record.getSandboxType(), record.getId());
        }
        return json.createObjectNode().put("accepted", true).put("id", record.getId().toString());
    }

    /** 查询历史和当前实例，运行时缺失不推断为停止。 */
    private JsonNode list(JsonNode input) {
        Map<String, Object> query = new HashMap<>();
        query.put("keyword", text(input, "keyword", 128));
        query.put("enterpriseId", input.path("enterpriseId").isNull()
            || input.path("enterpriseId").isMissingNode() ? null : id(input, "enterpriseId"));
        query.put("status", option(input, "status", Set.of("", "RUNNING", "STARTING", "RELEASING", "RELEASED", "FAILED")));
        query.put("ownerScope", option(input, "ownerScope", Set.of("", "USER", "TENANT")));
        int pageNum = page(input, "pageNum", 1, 10000);
        int pageSize = page(input, "pageSize", 20, 100);
        PageInfo<OperationsSandboxVo> page;
        try {
            PageHelper.startPage(pageNum, pageSize);
            page = new PageInfo<>(records.selectRows(query));
        } finally {
            PageHelper.clearPage();
        }
        Map<String, String> runtime = inventory.current();
        String sampledAt = Instant.now().toString();
        ObjectNode result = json.createObjectNode();
        ArrayNode list = result.putArray("list");
        page.getList().forEach(record -> list.add(view(record, runtime, sampledAt)));
        return result.put("total", page.getTotal()).put("pageNum", pageNum)
            .put("pageSize", pageSize).put("totalPages", page.getPages());
    }

    /** 工作组数据来自对应企业 Node，不读取主库遗留群表。 */
    private JsonNode groups(String operation, JsonNode input) {
        long enterpriseId = id(input, "enterpriseId");
        String path;
        String method;
        ObjectNode query = json.createObjectNode();
        if ("list".equals(operation)) {
            path = "/internal/v1/operations/groups/query";
            method = "POST";
            query.put("keyword", text(input, "keyword", 128));
            query.put("status", option(input, "status", Set.of("", "ACTIVE", "GROUP_DISSOLVED")));
        } else {
            long groupId = id(input, "id");
            path = "/internal/v1/operations/groups/" + groupId;
            if ("detail".equals(operation)) {
                method = "GET";
            } else if ("members".equals(operation)) {
                method = "POST";
                path += "/members/query";
            } else if ("conversations".equals(operation)) {
                method = "POST";
                path += "/conversations/query";
            } else {
                throw new OperationsFailure("INVALID");
            }
        }
        query.put("pageNum", page(input, "pageNum", 1, 10000));
        query.put("pageSize", page(input, "pageSize", 20, 100));
        return nodes.operationsRequest(enterpriseId, method, path, "GET".equals(method) ? null : query,
            new TypeReference<JsonNode>() { });
    }

    /** OpenClaw 的档位通过既有 serviceKey 契约传递，避免重新启动后回到默认规格。 */
    private String launchServiceKey(OperationsSandboxVo record) {
        String profile = record.getProfileKey();
        if ("openclaw".equals(record.getSandboxType()) && profile != null && !profile.isBlank()) {
            return "openclaw-" + profile;
        }
        return record.getSandboxType();
    }

    /** 详情显式列字段，实体中的网关 Token、端点和配置永不序列化。 */
    private ObjectNode view(OperationsSandboxVo record, Map<String, String> runtime, String sampledAt) {
        ObjectNode result = json.createObjectNode();
        result.put("id", record.getId().toString());
        result.put("enterpriseId", Objects.toString(record.getEnterpriseId(), null));
        result.put("enterpriseName", record.getEnterpriseName());
        result.put("resourceId", Objects.toString(record.getResourceId(), null));
        result.put("ownerScope", record.getOwnerScope());
        result.put("userCode", record.getUserCode());
        result.put("userName", record.getUserName());
        result.put("sandboxType", record.getSandboxType());
        result.put("sandboxId", record.getSandboxId());
        result.put("profileKey", record.getProfileKey());
        result.put("status", record.getStatus());
        result.put("currentRecord", record.isCurrentRecord());
        result.put("runtimeStatus", runtime.getOrDefault(Objects.toString(record.getSandboxId(), ""), "UNKNOWN"));
        result.put("sampledAt", sampledAt);
        result.put("createdAt", timestamp(record.getCreateTime()));
        result.put("lastActivityAt", timestamp(record.getLastAccessTime()));
        result.put("revision", revision(record));
        result.put("canStart", can(record, "start") && !hasActiveRuntime(record, runtime));
        result.put("canRelease", can(record, "release"));
        result.put("canRestart", can(record, "restart"));
        return result;
    }

    /** 历史脏记录即使标为已释放，也不能在已确认仍有活实例时再次启动。 */
    private boolean hasActiveRuntime(OperationsSandboxVo record, Map<String, String> runtime) {
        String state = runtime.getOrDefault(Objects.toString(record.getSandboxId(), ""), "UNKNOWN");
        return Set.of("RUNNING", "STARTING", "RELEASING").contains(state);
    }

    /** 操作能力严格区分用户实例与企业持久资源，不对旧记录重放命令。 */
    private boolean can(OperationsSandboxVo record, String action) {
        if (!record.isCurrentRecord()) {
            return false;
        }
        String status = Objects.toString(record.getStatus(), "");
        if ("TENANT".equals(record.getOwnerScope())) {
            return "restart".equals(action) && record.getEnterpriseId() != null
                && Set.of("tenant-opengauss", "tenant-data-node").contains(
                    Objects.toString(record.getSandboxType(), ""))
                && Set.of("RUNNING", "FAILED").contains(status);
        }
        if (!"USER".equals(record.getOwnerScope())) {
            return false;
        }
        if ("start".equals(action)) {
            return record.isUserActive() && record.getSandboxType() != null
                && Set.of("RELEASED", "FAILED").contains(status);
        }
        return "release".equals(action) && Set.of("RUNNING", "STARTING").contains(status);
    }

    /** 版本来自现有乐观锁与持久状态，兼容旧记录的空版本。 */
    private String revision(OperationsSandboxVo record) {
        return record.getId() + ":" + Objects.toString(record.getLockVersion(), "0") + ":" + record.getStatus();
    }

    /** 缺失或非运营资源统一返回不存在。 */
    private OperationsSandboxVo requireRecord(long id) {
        OperationsSandboxVo record = records.selectDetail(id);
        if (record == null) {
            throw new OperationsFailure("NOT_FOUND");
        }
        return record;
    }

    /** 标识必须是规范十进制字符串，避免 JSON 浮点损失精度。 */
    private long id(JsonNode input, String field) {
        String value = text(input, field, 19);
        if (!value.matches("[1-9][0-9]{0,18}")) {
            throw new OperationsFailure("INVALID");
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException failure) {
            throw new OperationsFailure("INVALID");
        }
    }

    /** 只接受有界整数分页值。 */
    private int page(JsonNode input, String field, int fallback, int maximum) {
        JsonNode value = input.path(field);
        if (value.isMissingNode() || value.isNull()) {
            return fallback;
        }
        if (!value.isIntegralNumber() || !value.canConvertToInt()
            || value.intValue() < 1 || value.intValue() > maximum) {
            throw new OperationsFailure("INVALID");
        }
        return value.intValue();
    }

    /** 对过滤项使用白名单，避免无效状态被解释为全量。 */
    private String option(JsonNode input, String field, Set<String> allowed) {
        String value = text(input, field, 32);
        if (!allowed.contains(value)) {
            throw new OperationsFailure("INVALID");
        }
        return value;
    }

    /** 读取有界文本，空过滤项保持为空。 */
    private String text(JsonNode input, String field, int maximum) {
        JsonNode value = input.path(field);
        if (value.isNull() || value.isMissingNode()) {
            return "";
        }
        if (!value.isTextual() || value.textValue().length() > maximum) {
            throw new OperationsFailure("INVALID");
        }
        return value.textValue().trim();
    }

    /** Date 转 ISO 时间，避免前端猜测服务器时区。 */
    private String timestamp(Date value) {
        return value == null ? null : value.toInstant().toString();
    }
}

