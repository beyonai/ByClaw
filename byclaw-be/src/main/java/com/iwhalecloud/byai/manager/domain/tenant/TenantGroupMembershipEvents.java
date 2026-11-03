package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Broadcast only the membership facts and system messages committed by the Node.
 */
final class TenantGroupMembershipEvents {
    private static final Logger LOG = LoggerFactory.getLogger(TenantGroupMembershipEvents.class);

    private TenantGroupMembershipEvents() {
    }

    /**
     * 消费 Node 在成员表实际插入后记录的事实，与邀请及聊天系统消息解耦。
     */
    static void joined(com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook hooks,
                       TenantRequestContext tenant, String sessionId, TenantNodeModels.CommandResult result) {
        boolean membershipCommand = result == null || "CREATE_GROUP".equals(result.operation())
            || "ADD_MEMBERS".equals(result.operation()) || "JOIN_GROUP".equals(result.operation());
        if (result == null || result.data() == null) {
            if (membershipCommand) {
                LOG.info("用户添加触发勾子失败，命令结果或data为空,userId={},enterpriseId={},groupId={},result={}", tenant.userId(), tenant.enterpriseId(), sessionId, JsonUtil.toJSONString(result));
            }
            return;
        }
        var notices = result.data().path("savedMembers");
        if (!notices.isArray()) {
            if (membershipCommand) {
                LOG.info("用户添加触发勾子失败，savedMembers缺失或非数组,userId={},enterpriseId={},groupId={},result={},data={}", tenant.userId(), tenant.enterpriseId(), sessionId, JsonUtil.toJSONString(result), result.data());
            }
            return;
        }
        if (notices.isEmpty()) {
            LOG.info("用户添加未触发勾子，新增成员为空,userId={},enterpriseId={},groupId={},result={},data={}", tenant.userId(), tenant.enterpriseId(), sessionId, JsonUtil.toJSONString(result), result.data());
        }
        var users = new java.util.HashSet<String>();
        for (var notice : notices) {
            if (!sessionId.equals(notice.path("groupId").asText())
                || !Long.toString(tenant.enterpriseId()).equals(notice.path("enterpriseId").asText())) {
                LOG.info("用户添加触发勾子失败，成员归属不一致,userId={},enterpriseId={},groupId={},requestId={},notice={}", tenant.userId(), tenant.enterpriseId(), sessionId, result.requestId(), notice);
                throw new IllegalStateException("groupchat.member.ownership.unconfirmed");
            }
            if (users.add(notice.path("byaiSessionMemberId").asText())) {
                LOG.info("用户添加开始触发勾子,userId={},enterpriseId={},groupId={},requestId={},notice={}", tenant.userId(), tenant.enterpriseId(), sessionId, result.requestId(), notice);
                hooks.memberJoined(sessionId, tenant.enterpriseId(), notice.path("userId").asText(),
                    notice.path("invitedBy").asText(), notice.path("byaiSessionMemberId").asText());
                LOG.info("用户添加调用勾子完成,requestId={},notice={}", result.requestId(), notice);
            } else {
                LOG.info("用户添加跳过重复成员勾子,requestId={},notice={}", result.requestId(), notice);
            }
        }
    }

    static void publish(GroupChatEventPublisher events, TenantRequestContext tenant, Long sessionId,
                        TenantNodeModels.CommandResult result) {
        publish(events, tenant, sessionId, result, "MEMBER_ADDED", null);
    }

    static void publish(GroupChatEventPublisher events, TenantRequestContext tenant, Long sessionId,
                        TenantNodeModels.CommandResult result, String membershipEvent, java.util.List<?> previousMembers) {
        if (result == null || result.data() == null) return;
        var notices = result.data().path("systemEvents");
        if (!notices.isArray() || notices.isEmpty()) return;
        Runnable publish = () -> {
            var membership = new JSONObject();
            membership.put("type", "GROUP_CHAT_EVENT");
            membership.put("event", membershipEvent);
            membership.put("sessionId", sessionId.toString());
            java.util.function.Consumer<JSONObject> broadcast = notification -> {
                if (previousMembers == null) events.publishTenant(tenant, sessionId, notification);
                else events.publishTenantMembers(tenant, notification, previousMembers);
            };
            broadcast.accept(membership);
            notices.forEach(notice -> broadcast.accept(JSONObject.parseObject(notice.toString())));
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publish.run();
                }
            });
        } else publish.run();
    }
}
