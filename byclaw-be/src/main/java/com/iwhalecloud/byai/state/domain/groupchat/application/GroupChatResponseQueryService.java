package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.groupchat.GroupResponsePhase;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupData;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatResponseMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatResponseProjection;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** 两种存储后端的群响应查询与权限边界；创建者 Codex，2026-11-13。 */
@Service
public class GroupChatResponseQueryService {
    @Autowired
    private ByaiGroupChatResponseMapper responseMapper;

    @Autowired
    private GroupChatAuthorizationService authorizationService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private TenantGroupData tenantGroupData;

    @Autowired
    private TenantModeService tenantModeService;

    @Autowired
    private RunningChatSnapshotService snapshotService;

    /** 接收回执返回本条消息实际创建的执行，避免前端根据 @ 猜测调度。 */
    public List<JSONObject> forSource(Long groupId, Long sourceId) {
        List<String> ids = responseMapper.selectIdsBySource(groupId, sourceId);
        return resolve(groupId, ids).getJSONArray("items").toJavaList(JSONObject.class);
    }

    /** 发现本群尚未成为任务或正式回复的执行。 */
    public JSONObject list(Long groupId, String cursor, int limit) {
        if (limit < 1 || limit > 100 || (cursor != null && !cursor.matches("[a-z:0-9]*"))) {
            throw new GroupChatMessageRejectedException("Invalid response page");
        }
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        if (independent(tenant)) {
            return restoreStreams(JSON.parseObject(tenantGroupData.read(tenant, "group-chats/" + groupId + "/responses?limit="
                + limit + (cursor == null ? "" : "&cursor=" + cursor)).toString()), tenant.userId());
        }
        requireMember(groupId, CurrentUserHolder.getCurrentUserId(), tenant);
        List<Map<String, Object>> rows = responseMapper.selectResponses(groupId, cursor == null ? "" : cursor, limit + 1, null);
        JSONObject result = new JSONObject();
        result.put("items", rows.stream().limit(limit).map(row -> publicView(row, CurrentUserHolder.getCurrentUserId())).toList());
        if (rows.size() > limit) {
            result.put("nextCursor", rows.get(limit - 1).get("responseId"));
        }
        return result;
    }

    /** 指定响应的权威终态也可恢复，不依赖其仍出现在活跃列表中。 */
    public JSONObject resolve(Long groupId, List<String> ids) {
        return resolveFor(groupId, ids, CurrentUserHolder.getCurrentUserId(), TenantRequestContextHolder.get());
    }

    /** 供已验证运行上下文和提交后通知使用；调用方不能接受客户端指定用户。 */
    public JSONObject resolveFor(Long groupId, List<String> ids, Long userId, TenantRequestContext tenant) {
        validateIds(ids);
        requireActor(userId, tenant);
        if (independent(tenant)) {
            return restoreStreams(JSON.parseObject(tenantGroupData.query(tenant, "group-chats/" + groupId + "/responses/resolve",
                Map.of("responseIds", ids)).toString()), userId);
        }
        requireMember(groupId, userId, tenant);
        List<JSONObject> items = ids.isEmpty() ? List.of() : responseMapper.selectResponses(groupId, "", 100, ids)
            .stream().map(row -> publicView(row, userId)).toList();
        JSONObject result = new JSONObject();
        result.put("items", items);
        result.put("unavailableIds", ids.stream().filter(id -> items.stream().noneMatch(item -> id.equals(item.getString("responseId")))).toList());
        return result;
    }

    /** 共享库群也必须验证可信租户范围，不能仅凭群 ID 查询。 */
    private void requireMember(Long groupId, Long userId, TenantRequestContext tenant) {
        requireActor(userId, tenant);
        authorizationService.requireUserMember(groupId, userId);
        Long enterprise = sessionService.findById(groupId).getEnterpriseId();
        if (tenant != null && !Objects.equals(enterprise, tenant.enterpriseId())) {
            throw new GroupChatMessageRejectedException("Response not accessible");
        }
    }

    /** 内部调用也只能沿可信租户身份查询，不能混用用户上下文。 */
    private void requireActor(Long userId, TenantRequestContext tenant) {
        if (userId == null || (tenant != null && !Objects.equals(userId, tenant.userId()))) {
            throw new GroupChatMessageRejectedException("Response not accessible");
        }
    }

    /** 独立租户的数据由 Node 持有，共享租户仍读现有 Mapper。 */
    public boolean independent(TenantRequestContext tenant) {
        return tenant != null && !tenantModeService.isSharedDataTenant(tenant.enterpriseId());
    }

    private JSONObject publicView(Map<String, Object> row, Long userId) {
        JSONObject view = GroupChatResponseProjection.view(row);
        view.put("canReadContent", String.valueOf(userId).equals(String.valueOf(row.get("initiatorUserId"))));
        if (view.getBooleanValue("canReadContent") && GroupResponsePhase.RUNNING.equals(view.getString("phase"))
            && row.get("traceId") != null) {
            JSONObject stream = new JSONObject();
            stream.put("sessionId", String.valueOf(row.get("candidateSessionId")));
            stream.put("traceId", row.get("traceId"));
            view.put("stream", stream);
            restoreStream(view, userId);
        }
        return view;
    }

    /** Node 已完成群成员与发起人鉴权，Java 仅补充同一轮的既有运行快照。 */
    private JSONObject restoreStreams(JSONObject result, Long userId) {
        for (Object item : result.getJSONArray("items")) {
            restoreStream((JSONObject) item, userId);
        }
        return result;
    }

    /** 私有绑定只返回给发起人；正文沿用运行快照，不另建缓存或推送通道。 */
    private void restoreStream(JSONObject view, Long userId) {
        JSONObject stream = view.getJSONObject("stream");
        if (!view.getBooleanValue("canReadContent") || stream == null
            || !String.valueOf(userId).equals(view.getString("initiatorUserId"))) return;
        String traceId = stream.getString("traceId");
        Long answerId = TraceIdCodec.canDecode(traceId) ? TraceIdCodec.decode(traceId).getModelAnswerMessageId() : null;
        if (answerId != null) stream.put("messageId", answerId.toString());
        var snapshot = snapshotService.get(stream.getLong("sessionId"), traceId, answerId);
        if (snapshot == null || !Boolean.TRUE.equals(snapshot.getRunning())
            || !Objects.equals(snapshot.getCreatorId(), userId)
            || !Objects.equals(snapshot.getSessionId(), stream.getLong("sessionId"))
            || !Objects.equals(snapshot.getTraceId(), traceId)
            || (answerId != null && !Objects.equals(snapshot.getModelAnswerMessageId(), answerId))) return;
        stream.put("messageId", String.valueOf(snapshot.getModelAnswerMessageId()));
        stream.put("streamId", snapshot.getSnapshotStreamId());
        // 保留 contentType 与片段顺序；发起人使用普通聊天同一套预览，不再提前压成纯文本。
        stream.put("messageStruct", snapshot.getMessageStruct());
        stream.put("inferLog", snapshot.getInferLog());
    }

    private void validateIds(List<String> ids) {
        if (ids == null || ids.size() > 100 || ids.stream().anyMatch(id -> id == null || !id.matches("(turn|execution|task):[0-9]+"))) {
            throw new GroupChatMessageRejectedException("Invalid response identities");
        }
    }
}
