package com.iwhalecloud.byai.manager.domain.operations;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.operations.MemberGroupRemovalMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** 企业移除交接：兼容存量工作组和租户 Node，服务端选接任人，不删除工作组资源。 @author Codex @since 2026-10-27 */
@Service
public class MemberGroupRemovalService {
    @Autowired private MemberGroupRemovalMapper members;
    @Autowired private TenantAdminTenantMapper tenants;
    @Autowired private TenantNodeClient nodes;
    @Autowired private SessionService sessions;
    @Autowired private ObjectMapper json;

    /** @param operation preview 或 apply @param input 企业、成员、已确认的计划版本 @param actor 已认证操作人 @return 交接计划或完成标记 */
    @Transactional
    public JsonNode execute(String operation, JsonNode input, String actor) {
        long enterpriseId = identifier(input.path("enterpriseId").asText());
        long userId = identifier(input.path("userId").asText());
        long actorId = identifier(actor);
        Map<String, Object> operator = members.actor(enterpriseId, actorId);
        if (operator == null || userId == actorId) {
            throw new OperationsFailure("DENIED");
        }
        List<Map<String, Object>> legacy = members.snapshot(enterpriseId, userId);
        if ("apply".equals(operation)) {
            // 沿用群生命周期的事务级 Redis 锁，锁持续到本次事务结束。
            legacy.stream().map(row -> Long.valueOf(row.get("sessionId").toString())).distinct().sorted()
                .forEach(sessions::lockById);
            legacy = members.snapshot(enterpriseId, userId);
        } else if (!"preview".equals(operation)) {
            throw new OperationsFailure("INVALID");
        }
        // 试用组织的工作组保存在共享库，不依赖独立 Node；历史 Node 配置也不能改变试用路由。
        boolean publicTrialTenant = "TRIAL".equals(tenants.selectConfig(enterpriseId, "TENANT_MODE"));
        String nodeRecord = publicTrialTenant ? null : tenants.selectConfig(enterpriseId, "NODE_SANDBOX_RECORD_ID");
        boolean hasNode = nodeRecord != null && !nodeRecord.isBlank();
        // 默认企业与试用组织使用共享库；独立租户缺少 Node 配置仍不能降级为空工作组。
        if (!hasNode && !publicTrialTenant && enterpriseId != 1 && !RuntimeEnvironment.isDevelopment()) {
            throw new OperationsFailure("UNAVAILABLE");
        }
        JsonNode remote = hasNode ? nodes.memberGroupRemoval(enterpriseId, "snapshot",
            Map.of("userId", Long.toString(userId)), new TypeReference<JsonNode>() { }) : json.createObjectNode();
        if (hasNode && (remote == null || !remote.path("rows").isArray()
            || !remote.path("revision").asText().matches("[a-f0-9]{64}"))) {
            throw new OperationsFailure("UNAVAILABLE");
        }
        List<JsonNode> localRows = new ArrayList<>();
        json.valueToTree(legacy).forEach(localRows::add);
        List<JsonNode> remoteRows = new ArrayList<>();
        remote.path("rows").forEach(remoteRows::add);
        Map<String, String> eligible = new HashMap<>();
        members.candidates(enterpriseId).forEach(candidate -> eligible.put(candidate.get("userId").toString(),
            Objects.toString(candidate.get("name"), candidate.get("userId").toString())));
        if (enterpriseId == 1 || eligible.containsKey(actor)) {
            // 默认企业兼容内置管理员；独立租户接任人必须具有启用的企业关系。
            eligible.put(actor, Objects.toString(operator.get("name"), actor));
        }
        eligible.remove(Long.toString(userId));
        ArrayNode localTransfers = transfers(localRows, Long.toString(userId), eligible);
        ArrayNode nodeTransfers = transfers(remoteRows, Long.toString(userId), eligible);
        ObjectNode plan = json.createObjectNode();
        ArrayNode transfers = plan.putArray("transfers");
        localTransfers.forEach(transfers::add);
        nodeTransfers.forEach(transfers::add);
        plan.put("groupCount", localRows.stream().map(row -> row.path("sessionId").asText()).distinct().count()
            + remoteRows.stream().map(row -> row.path("sessionId").asText()).distinct().count());
        plan.put("revision", digest(enterpriseId + ":" + userId + ":" + actor + ":"
            + json.valueToTree(legacy).toString() + remote.toString() + transfers.toString()));
        if ("preview".equals(operation)) {
            return plan;
        }
        if (!plan.path("revision").asText().equals(input.path("expectedGroupRevision").asText())
            || (!transfers.isEmpty() && !input.path("confirmOwnershipTransfer").asBoolean(false))) {
            throw new OperationsFailure("CONFLICT");
        }
        applyLocal(enterpriseId, userId, localRows, localTransfers);
        if (!members.snapshot(enterpriseId, userId).isEmpty()) {
            // 并发新入群或新建群不使用旧确认静默处理，回滚后重新生成交接名单。
            throw new OperationsFailure("CONFLICT");
        }
        if (hasNode) {
            JsonNode result = nodes.memberGroupRemoval(enterpriseId, "apply", Map.of("userId", Long.toString(userId),
                "expectedRevision", remote.path("revision").asText(), "transfers", nodeTransfers),
                new TypeReference<JsonNode>() { });
            if (!result.path("completed").asBoolean(false)) {
                throw new OperationsFailure("UNKNOWN");
            }
        }
        return json.createObjectNode().put("completed", true);
    }

    /** 优先管理员（任命时间）、再普通成员（入群时间）；接任人必须已在群内并有企业访问资格。 */
    private ArrayNode transfers(List<JsonNode> rows, String userId, Map<String, String> eligible) {
        ArrayNode result = json.createArrayNode();
        rows.stream().filter(row -> userId.equals(row.path("userId").asText()) && "OWNER".equals(row.path("role").asText()))
            .forEach(owner -> {
                String group = owner.path("sessionId").asText();
                String successor = rows.stream().filter(row -> group.equals(row.path("sessionId").asText()))
                    .filter(row -> eligible.containsKey(row.path("userId").asText()))
                    .min(Comparator.comparingInt((JsonNode row) -> "ADMIN".equals(row.path("role").asText()) ? 0 : 1)
                        .thenComparingLong(this::orderTime).thenComparingLong(row -> row.path("memberId").asLong()))
                    .map(row -> row.path("userId").asText()).orElse(null);
                if (successor == null) {
                    throw new OperationsFailure("NO_SUCCESSOR");
                }
                result.addObject().put("sessionId", group).put("groupName", owner.path("groupName").asText())
                    .put("userId", successor).put("name", eligible.get(successor));
            });
        return result;
    }

    /** @return 稳定排序时间，兼容未记录管理员任命时间的存量工作组 */
    private long orderTime(JsonNode row) {
        String appointed = row.path("adminSince").asText("");
        if ("ADMIN".equals(row.path("role").asText()) && appointed.matches("[0-9]{1,18}")) {
            return Long.parseLong(appointed);
        }
        JsonNode joined = row.path("joinedAt");
        if (joined.isNumber() || joined.asText("").matches("[0-9]{1,18}")) {
            return joined.asLong();
        }
        try {
            return Instant.parse(joined.asText()).toEpochMilli();
        } catch (Exception ignored) {
            return Long.MAX_VALUE;
        }
    }

    /** 存量群在已有群锁和事务内交接；保留文件、任务、创建人及消息记录。 */
    private void applyLocal(long enterpriseId, long userId, List<JsonNode> rows, ArrayNode transfers) {
        for (JsonNode transfer : transfers) {
            JsonNode existing = rows.stream().filter(row -> row.path("sessionId").equals(transfer.path("sessionId"))
                && row.path("userId").equals(transfer.path("userId"))).findFirst().orElse(null);
            ByaiSessionMember target = new ByaiSessionMember();
            target.setUserRole("OWNER");
            if (existing == null) {
                throw new OperationsFailure("CONFLICT");
            }
            target.setByaiSessionMemberId(Long.valueOf(existing.path("memberId").asText()));
            members.updateById(target);
        }
        List<String> groups = rows.stream().map(row -> row.path("sessionId").asText()).distinct().toList();
        if (!groups.isEmpty()) {
            members.delete(new QueryWrapper<ByaiSessionMember>().eq("com_acct_id", enterpriseId)
                .eq("mem_obj_type", "USER").eq("mem_obj_id", userId).in("session_id", groups));
        }
    }

    /** @return 包含接任人及成员快照的不可预测外推版本 */
    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new OperationsFailure("UNAVAILABLE");
        }
    }

    /** @return 规范的长整型身份；禁止浮点身份进入查询 */
    private long identifier(String value) {
        try {
            if (!value.matches("[1-9][0-9]{0,18}")) {
                throw new OperationsFailure("INVALID");
            }
            return Long.parseLong(value);
        } catch (NumberFormatException failure) {
            throw new OperationsFailure("INVALID");
        }
    }
}
