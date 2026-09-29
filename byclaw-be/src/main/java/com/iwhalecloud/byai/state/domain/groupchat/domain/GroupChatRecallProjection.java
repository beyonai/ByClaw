package com.iwhalecloud.byai.state.domain.groupchat.domain;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

import lombok.extern.slf4j.Slf4j;

/** 每次查询独立创建，统一屏蔽撤回内容并复用同一操作人的 Redis 名称读取。 */
@Slf4j
public final class GroupChatRecallProjection {
    public static final String RECALLED_REFERENCE = "消息已撤回";
    private final Map<Long, String> names = new HashMap<>();

    public String operatorName(Long userId) {
        if (userId == null) return "未知用户";
        return names.computeIfAbsent(userId, id -> {
            try {
                ShareBfmUser user = ShareCacheUtil.getShareBfmUser(id);
                if (user != null && user.getUserName() != null && !user.getUserName().isBlank()) {
                    return user.getUserName();
                }
            }
            catch (RuntimeException error) {
                // 不记录缓存载荷；用户名缓存故障不能让原消息内容重新出现。
                log.warn("撤回操作人缓存读取失败, userId={}, errorType={}", id, error.getClass().getSimpleName());
            }
            return "用户（" + id + "）";
        });
    }

    public String content(Long operatorId) {
        return operatorName(operatorId) + " 撤回了一条消息";
    }

    public GroupChatContextResponse.Recall recall(Date time, Long operatorId) {
        if (time == null) return null;
        GroupChatContextResponse.Recall recall = new GroupChatContextResponse.Recall();
        recall.setOperatorId(operatorId == null ? null : String.valueOf(operatorId));
        recall.setOperatorName(operatorName(operatorId));
        recall.setRecalledAt(time.getTime());
        return recall;
    }

    /** 白名单复制身份与关系；原实体不会被修改，也不会把内容副本带到响应中。 */
    public ByaiMessage display(ByaiMessage source) {
        if (source == null || !source.isRecalled()) return source;
        ByaiMessage safe = new ByaiMessage();
        safe.setId(source.getId());
        safe.setMessageId(source.getMessageId());
        safe.setSessionId(source.getSessionId());
        safe.setTaskId(source.getTaskId());
        safe.setTopicId(source.getTopicId());
        safe.setMessageRef(source.getMessageRef());
        safe.setRelMessageId(source.getRelMessageId());
        safe.setUsage(source.getUsage());
        safe.setRole(source.getRole());
        safe.setCreatorId(source.getCreatorId());
        safe.setCreatorName(source.getCreatorName());
        safe.setCreateTime(source.getCreateTime());
        safe.setUpdateTime(source.getUpdateTime());
        safe.setProjectId(source.getProjectId());
        safe.setEnterpriseId(source.getEnterpriseId());
        safe.setIsComplete(source.getIsComplete());
        safe.setRecalledAt(source.getRecalledAt());
        safe.setRecalledBy(source.getRecalledBy());
        safe.setMessageContent(content(source.getRecalledBy()));
        // 元数据中的业务身份仍可用于定位任务，但正文、资源、文件和工具信息不能透传。
        JSONObject metadata = new JSONObject();
        try {
            JSONObject original = JSON.parseObject(source.getMetadata());
            if (original != null) {
                for (String key : new String[] {"scene", "kind", "taskId", "clientRequestId", "agentId"}) {
                    Object value = original.get(key);
                    if (value instanceof String || value instanceof Number) metadata.put(key, value);
                }
            }
        }
        catch (RuntimeException ignored) {
            // 历史元数据损坏时仍返回安全占位。
        }
        safe.setMetadata(metadata.toJSONString());
        return safe;
    }

    /** 引用消息只返回固定占位，不需要查询操作人信息。 */
    public static String referenceContent(ByaiMessage source) {
        return source.isRecalled() ? RECALLED_REFERENCE : source.getMessageContent();
    }
}
