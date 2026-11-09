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
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.mapper.operations.OperationsGroupMapper;
import com.iwhalecloud.byai.manager.mapper.operations.OperationsSandboxMapper;
import com.iwhalecloud.byai.manager.vo.operations.OperationsSandboxVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Future;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import jakarta.annotation.PreDestroy;

/** 复用现有生命周期能力与租户查询通道；不增加停用策略。
 * @author Codex
 * @since 2026-10-23
 */
@Service
public class PlatformOperationsService {
    private static final Logger LOG = LoggerFactory.getLogger(PlatformOperationsService.class);
    private final ThreadPoolExecutor groupQueries = new ThreadPoolExecutor(5, 5, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(20));

    @PreDestroy
    void closeGroupQueries() {
        groupQueries.shutdownNow();
    }
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
    private TenantModeService tenantModes;
    @Autowired
    private OperationsGroupMapper groupRecords;
    @Autowired
    private ObjectMapper json;
    @Autowired
    private MemberGroupRemovalService memberGroupRemoval;

    @Autowired
    private TenantAdministrationOperations tenantAdministrationOperations;

    @Autowired
    private EnterpriseStorageService enterpriseStorageService;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private UserService userService;

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
        if (Set.of("tenant-admin", "tenant-datasource").contains(resource)) {
            return tenantAdministrationOperations.execute(resource, operation, payload);
        }
        if ("enterprise-storage".equals(resource) && "summary".equals(operation)) {
            return enterpriseStorageService.summary(id(payload, "enterpriseId"), id(request, "actor"));
        }
        // 平台主体不等同企业成员；此入口只接受服务密钥认证且已在 HACU 完成平台授权的调用。
        if ("platform-storage".equals(resource) && "summary".equals(operation)) {
            return enterpriseStorageService.usage(id(payload, "enterpriseId"));
        }
        if ("member-removal".equals(resource)) {
            return memberGroupRemoval.execute(operation, payload, text(request, "actor", 128));
        }
        if ("groups".equals(resource)) {
            if ("aggregate".equals(operation)) {
                return aggregateGroups(payload);
            }
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

    /** 跨企业按来源分页，跳过故障来源并返回其标识。 */
    private JsonNode aggregateGroups(JsonNode input) {
        int pageSize = page(input, "pageSize", 20, 100);
        String cursor = text(input, "cursor", 80);
        long afterId = 0;
        int sourcePage = 1;
        if (!cursor.isEmpty()) {
            if (!cursor.matches("[0-9]{1,19}:[1-9][0-9]{0,4}")) throw new OperationsFailure("INVALID");
            try {
                String[] parts = cursor.split(":");
                afterId = Long.parseLong(parts[0]);
                sourcePage = Integer.parseInt(parts[1]);
                if (sourcePage > 10000 || (sourcePage > 1 && afterId == 0)) throw new OperationsFailure("INVALID");
            } catch (NumberFormatException failure) {
                throw new OperationsFailure("INVALID");
            }
        }
        String keyword = text(input, "keyword", 128);
        String status = option(input, "status", Set.of("", "ACTIVE", "GROUP_DISSOLVED"));
        long sourceAfter = sourcePage > 1 ? afterId - 1 : afterId;
        List<Map<String, Object>> sources = groupRecords.sources(sourceAfter);
        ObjectNode result = json.createObjectNode();
        ArrayNode failures = result.putArray("failedTenants");
        result.putArray("list");
        result.putNull("nextCursor");
        int limit = Math.min(10, sources.size());
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        for (int index = 0; index < limit; index++) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) break;
            Map<String, Object> source = sources.get(index);
            long enterpriseId = Long.parseLong(source.get("enterpriseId").toString());
            int currentPage = sourcePage > 1 && enterpriseId == afterId ? sourcePage : 1;
            ObjectNode query = json.createObjectNode().put("enterpriseId", Long.toString(enterpriseId))
                .put("pageNum", currentPage).put("pageSize", pageSize).put("keyword", keyword).put("status", status);
            Future<JsonNode> pending = null;
            try {
                pending = groupQueries.submit(() -> groups("list", query));
                JsonNode page = pending.get(remaining, TimeUnit.NANOSECONDS);
                if (!page.path("list").isArray() || !page.path("totalPages").isIntegralNumber()) {
                    throw new OperationsFailure("UNAVAILABLE");
                }
                result.set("list", page.path("list"));
                if (currentPage < page.path("totalPages").asInt()) {
                    result.put("nextCursor", enterpriseId + ":" + (currentPage + 1));
                } else if (index + 1 < sources.size()) {
                    result.put("nextCursor", enterpriseId + ":1");
                } else {
                    result.putNull("nextCursor");
                }
                if (!page.path("list").isEmpty()) {
                    result.put("partial", !failures.isEmpty());
                    return result;
                }
            } catch (InterruptedException failure) {
                if (pending != null) pending.cancel(true);
                Thread.currentThread().interrupt();
                throw new OperationsFailure("UNAVAILABLE");
            } catch (Exception failure) {
                if (pending != null) pending.cancel(true);
                LOG.error("Platform group source unavailable, enterpriseId={}", enterpriseId, failure);
                failures.addObject().put("enterpriseId", Long.toString(enterpriseId))
                    .put("enterpriseName", Objects.toString(source.get("enterpriseName"), ""));
            }
            if (index + 1 < sources.size()) result.put("nextCursor", enterpriseId + ":1");
            else result.putNull("nextCursor");
        }
        if (sources.isEmpty()) result.putNull("nextCursor");
        result.put("partial", !failures.isEmpty());
        return result;
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
        JsonNode result = tenantModes.isSharedDataTenant(enterpriseId)
            ? sharedGroups(operation, input, enterpriseId)
            : nodeGroups(operation, input, enterpriseId);
        if (result == null) {
            return null;
        }
        switch (operation) {
            case "list" -> resolveGroupProjects(enterpriseId, result.path("list"));
            case "detail" -> {
                resolveGroupProjects(enterpriseId, List.of(result));
                resolveGroupCreators(List.of(result));
            }
            case "conversations" -> resolveGroupCreators(result.path("list"));
            default -> { }
        }
        return result;
    }

    /**
     * 从企业 Node 读取分页数据或详情。
     *
     * @param operation 工作组操作
     * @param input 查询参数
     * @param enterpriseId 已校验的企业 ID
     * @return Node 的只读投影
     */
    private JsonNode nodeGroups(String operation, JsonNode input, long enterpriseId) {
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

    /**
     * 项目记录由主库管理，共享和独立租户都在当前企业范围内批量补齐名称。
     *
     * @param enterpriseId 工作组所属企业
     * @param rows 当前页或单条工作组记录
     */
    private void resolveGroupProjects(long enterpriseId, Iterable<JsonNode> rows) {
        Set<Long> projectIds = displayIds(rows, "projectId");
        if (projectIds.isEmpty()) {
            return;
        }
        Map<Long, String> projectNames = new HashMap<>();
        projectService.findNamesByIds(enterpriseId, projectIds)
            .forEach(project -> projectNames.put(project.getProjectId(), project.getProjectName()));
        rows.forEach(row -> putDisplayName(row, "projectId", "projectName", projectNames));
    }

    /**
     * 根据全局账号补齐详情中的创建人，兼容已停用的历史账号。
     *
     * @param rows 工作组详情或当前页关联会话
     */
    private void resolveGroupCreators(Iterable<JsonNode> rows) {
        Set<Long> creatorIds = displayIds(rows, "creatorId");
        if (creatorIds.isEmpty()) {
            return;
        }
        Map<Long, String> creatorNames = new HashMap<>();
        userService.findByIds(creatorIds)
            .forEach(user -> creatorNames.put(user.getUserId(), user.getUserName()));
        rows.forEach(row -> putDisplayName(row, "creatorId", "creatorName", creatorNames));
    }

    /**
     * 从投影收集去重后的主键，跳过空值和默认项目的占位 ID。
     *
     * @param rows 待补齐名称的记录
     * @param field 主键字段
     * @return 当前结果中的有效主键
     */
    private Set<Long> displayIds(Iterable<JsonNode> rows, String field) {
        return StreamSupport.stream(rows.spliterator(), false)
            .map(row -> row.path(field).asLong())
            .filter(id -> id > 0)
            .collect(Collectors.toSet());
    }

    /**
     * 仅补齐有效名称，保留原始 ID 供调用端排查。
     *
     * @param row 工作组或关联会话记录
     * @param idField 主键字段
     * @param nameField 名称字段
     * @param names 已查到的名称
     */
    private void putDisplayName(JsonNode row, String idField, String nameField, Map<Long, String> names) {
        String name = names.get(row.path(idField).asLong());
        if (row instanceof ObjectNode object && name != null && !name.isBlank()) {
            object.put(nameField, name);
        }
    }

    /** 公共企业及试用租户使用公共库，保留企业范围及分页。 */
    private JsonNode sharedGroups(String operation, JsonNode input, long enterpriseId) {
        int pageNum = page(input, "pageNum", 1, 10000);
        int pageSize = page(input, "pageSize", 20, 100);
        if ("detail".equals(operation)) {
            Map<String, Object> detail = groupRecords.detail(enterpriseId, id(input, "id"));
            if (detail == null) throw new OperationsFailure("NOT_FOUND");
            return json.valueToTree(detail);
        }
        long groupId = "list".equals(operation) ? 0 : id(input, "id");
        if (!"list".equals(operation) && groupRecords.detail(enterpriseId, groupId) == null) {
            throw new OperationsFailure("NOT_FOUND");
        }
        String keyword = text(input, "keyword", 128);
        String status = option(input, "status", Set.of("", "ACTIVE", "GROUP_DISSOLVED"));
        PageInfo<Map<String, Object>> result;
        try {
            PageHelper.startPage(pageNum, pageSize);
            List<Map<String, Object>> rows = switch (operation) {
                case "list" -> groupRecords.groups(enterpriseId, keyword, status);
                case "members" -> groupRecords.members(enterpriseId, groupId);
                case "conversations" -> groupRecords.conversations(enterpriseId, groupId);
                default -> throw new OperationsFailure("INVALID");
            };
            result = new PageInfo<>(rows);
        } finally {
            PageHelper.clearPage();
        }
        ObjectNode output = json.createObjectNode();
        output.set("list", json.valueToTree(result.getList()));
        return output.put("total", result.getTotal()).put("pageNum", pageNum)
            .put("pageSize", pageSize).put("totalPages", result.getPages());
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

