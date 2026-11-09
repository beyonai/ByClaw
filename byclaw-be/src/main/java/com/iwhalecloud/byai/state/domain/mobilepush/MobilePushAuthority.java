package com.iwhalecloud.byai.state.domain.mobilepush;

import java.util.Objects;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** 推送执行时再次检查成员、撤回和已读状态；不能仅信任消息发布时的成员快照。 */
@Service
public class MobilePushAuthority {
    private final TenantModeService modes;
    private final TenantNodeClient node;
    private final SessionService sessions;
    private final SessionMemberService members;
    private final ByaiMessageMapper messages;

    public MobilePushAuthority(TenantModeService modes, TenantNodeClient node, SessionService sessions,
                               SessionMemberService members, ByaiMessageMapper messages) {
        this.modes = modes;
        this.node = node;
        this.sessions = sessions;
        this.members = members;
        this.messages = messages;
    }

    public boolean allowed(PushNotification notification) {
        if (modes.isSharedDataTenant(notification.enterpriseId())) {
            var group = sessions.findById(notification.sessionId());
            var member = members.findSessionMember(notification.sessionId(), "USER", notification.accountId());
            var message = messages.selectByMessageId(notification.messageId());
            return group != null && Objects.equals(group.getEnterpriseId(), notification.enterpriseId())
                && !GroupChatAuthorizationService.DISSOLVED_STATE.equals(group.getState())
                && member != null && (member.getLastReadMessageId() == null
                    || member.getLastReadMessageId() < notification.messageId())
                && message != null && Objects.equals(message.getSessionId(), notification.sessionId())
                && Boolean.TRUE.equals(message.getIsComplete()) && !message.isRecalled();
        }
        // 使用真实接收人身份重新访问既有 Node 接口，由 Node 验证其当前成员权限。
        TenantRequestContext recipient = new TenantRequestContext(notification.accountId(), notification.enterpriseId(), "MEMBER");
        try {
            JsonNode context = node.request(recipient, "GET", "/internal/v1/group-chats/"
                + notification.sessionId() + "/messages/" + notification.messageId() + "/context", null,
                new TypeReference<JsonNode>() { });
            for (JsonNode message : context.path("messages")) {
                if (Long.toString(notification.messageId()).equals(message.path("messageId").asText())) {
                    return !message.path("recalled").asBoolean(false);
                }
            }
            return false;
        } catch (ResponseStatusException error) {
            if (error.getStatusCode().equals(HttpStatus.FORBIDDEN)
                || error.getStatusCode().equals(HttpStatus.NOT_FOUND)) {
                return false;
            }
            throw error;
        }
    }
}
