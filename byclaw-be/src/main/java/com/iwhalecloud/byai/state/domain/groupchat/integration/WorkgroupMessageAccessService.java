package com.iwhalecloud.byai.state.domain.groupchat.integration;

import java.util.Objects;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** 通用消息访问事实：复核成员、完整性、撤回和已读，显式摘要读取只返回有限公开展示字段。 */
@Service
public class WorkgroupMessageAccessService {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(WorkgroupMessageAccessService.class);
    private final com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();
    private final TenantModeService modes;
    private final TenantNodeClient node;
    private final SessionService sessions;
    private final SessionMemberService members;
    private final ByaiMessageMapper messages;

    public WorkgroupMessageAccessService(TenantModeService modes, TenantNodeClient node, SessionService sessions,
                               SessionMemberService members, ByaiMessageMapper messages) {
        this.modes = modes;
        this.node = node;
        this.sessions = sessions;
        this.members = members;
        this.messages = messages;
    }

    public boolean allowed(WorkgroupMessageQuery notification) {
        if (modes.isSharedDataTenant(notification.enterpriseId())) {
            var group = sessions.findById(notification.sessionId());
            var member = members.findSessionMember(notification.sessionId(), "USER", notification.accountId());
            var message = messages.selectByMessageId(notification.messageId());
            return group != null && SessionType.HS_AS.getCode().equals(group.getSessionType())
                && Objects.equals(group.getEnterpriseId(), notification.enterpriseId())
                && !GroupChatAuthorizationService.DISSOLVED_STATE.equals(group.getState())
                && member != null && (member.getLastReadMessageId() == null
                    || member.getLastReadMessageId() < notification.messageId())
                && message != null && Objects.equals(message.getSessionId(), notification.sessionId())
                && Boolean.TRUE.equals(message.getIsComplete()) && !message.isRecalled();
        }
        // 使用真实接收人身份重新访问既有 Node 接口，由 Node 验证其当前成员权限。
        TenantRequestContext recipient = new TenantRequestContext(notification.accountId(), notification.enterpriseId(), "MEMBER");
        try {
            JsonNode detail = node.request(recipient, "GET", "/internal/v1/group-chats/"
                + notification.sessionId(), null, new TypeReference<JsonNode>() { });
            boolean unread = false;
            for (JsonNode member : detail.path("members")) {
                if ("USER".equals(member.path("memObjType").asText())
                    && Long.toString(notification.accountId()).equals(member.path("memObjId").asText())) {
                    JsonNode lastRead = member.path("lastReadMessageId");
                    unread = lastRead.isNull() || lastRead.isMissingNode()
                        || new java.math.BigInteger(lastRead.asText()).compareTo(
                            java.math.BigInteger.valueOf(notification.messageId())) < 0;
                }
            }
            if (!unread) return false;
            JsonNode context = node.request(recipient, "GET", "/internal/v1/group-chats/"
                + notification.sessionId() + "/messages/" + notification.messageId() + "/context", null,
                new TypeReference<JsonNode>() { });
            for (JsonNode message : context.path("messages")) {
                if (Long.toString(notification.messageId()).equals(message.path("messageId").asText())) {
                    return message.path("complete").isBoolean() && message.path("complete").asBoolean()
                        && !message.path("recalled").asBoolean(false);
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
    public boolean member(long enterpriseId, long sessionId, long accountId) {
        if (modes.isSharedDataTenant(enterpriseId)) {
            var group = sessions.findById(sessionId);
            return group != null && SessionType.HS_AS.getCode().equals(group.getSessionType())
                && Objects.equals(group.getEnterpriseId(), enterpriseId)
                && !GroupChatAuthorizationService.DISSOLVED_STATE.equals(group.getState())
                && members.findSessionMember(sessionId, "USER", accountId) != null;
        }
        try {
            JsonNode detail = node.request(new TenantRequestContext(accountId, enterpriseId, "MEMBER"),
                "GET", "/internal/v1/group-chats/" + sessionId, null, new TypeReference<JsonNode>() { });
            for (JsonNode member : detail.path("members")) {
                if ("USER".equals(member.path("memObjType").asText())
                    && Long.toString(accountId).equals(member.path("memObjId").asText())) return true;
            }
            return false;
        } catch (ResponseStatusException error) {
            if (error.getStatusCode().equals(HttpStatus.FORBIDDEN)
                || error.getStatusCode().equals(HttpStatus.NOT_FOUND)) return false;
            throw error;
        }
    }

    /**
     * 发送时重新核对访问事实，再提取最小公开摘要；拒绝访问时不返回任何名称或正文。
     * @param notification 已认证服务指定的接收人及消息定位
     * @return 可见摘要，或消息已读、撤回、未完成及无权限时的 null
     */
    public WorkgroupMessagePreview preview(WorkgroupMessageQuery notification) {
        if (!allowed(notification)) {
            return null;
        }
        if (modes.isSharedDataTenant(notification.enterpriseId())) {
            var group = sessions.findById(notification.sessionId());
            var message = messages.selectByMessageId(notification.messageId());
            var member = members.findSessionMember(notification.sessionId(), "USER", notification.accountId());
            if (group == null || !Objects.equals(group.getEnterpriseId(), notification.enterpriseId())
                || !SessionType.HS_AS.getCode().equals(group.getSessionType())
                || GroupChatAuthorizationService.DISSOLVED_STATE.equals(group.getState())
                || member == null || (member.getLastReadMessageId() != null
                    && member.getLastReadMessageId() >= notification.messageId())
                || message == null || message.isRecalled()
                || !Boolean.TRUE.equals(message.getIsComplete())
                || !Objects.equals(message.getSessionId(), notification.sessionId())) {
                return null;
            }
            String senderType = "UNKNOWN";
            if (Integer.valueOf(1).equals(message.getUsage())) {
                senderType = "USER";
            } else if (Integer.valueOf(2).equals(message.getUsage())) {
                senderType = "AGENT";
            } else if (Integer.valueOf(5).equals(message.getUsage())) {
                senderType = "SYSTEM";
            }
            String senderName = message.getCreatorName();
            // 员工消息的 creatorId 可能是创建者；仅真人消息查询真人群昵称，不能冒充员工身份。
            if ("USER".equals(senderType) && message.getCreatorId() != null) {
                var sender = members.findSessionMember(notification.sessionId(), "USER", message.getCreatorId());
                if (sender != null && sender.getMemName() != null && !sender.getMemName().isBlank()) {
                    senderName = sender.getMemName();
                }
            }
            JsonNode files = metadata(message.getRelatedResources()).path("files");
            return new WorkgroupMessagePreview(group.getSessionName(), senderName, senderType,
                message.getMessageContent(), metadata(message.getMetadata()).path("resourceList"),
                files.isArray() && !files.isEmpty());
        }
        TenantRequestContext recipient = new TenantRequestContext(notification.accountId(), notification.enterpriseId(), "MEMBER");
        try {
            JsonNode detail = node.request(recipient, "GET", "/internal/v1/group-chats/"
                + notification.sessionId(), null, new TypeReference<JsonNode>() { });
            boolean unread = false;
            for (JsonNode member : detail.path("members")) {
                if ("USER".equals(member.path("memObjType").asText())
                    && Long.toString(notification.accountId()).equals(member.path("memObjId").asText())) {
                    JsonNode lastRead = member.path("lastReadMessageId");
                    unread = lastRead.isNull() || lastRead.isMissingNode()
                        || new java.math.BigInteger(lastRead.asText()).compareTo(
                            java.math.BigInteger.valueOf(notification.messageId())) < 0;
                }
            }
            if (!unread) {
                return null;
            }
            JsonNode context = node.request(recipient, "GET", "/internal/v1/group-chats/"
                + notification.sessionId() + "/messages/" + notification.messageId() + "/context", null,
                new TypeReference<JsonNode>() { });
            for (JsonNode message : context.path("messages")) {
                if (Long.toString(notification.messageId()).equals(message.path("messageId").asText())
                    && message.path("complete").isBoolean() && message.path("complete").asBoolean()
                    && !message.path("recalled").asBoolean(false)) {
                    JsonNode speaker = message.path("speaker");
                    String senderName = speaker.path("displayName").asText("");
                    if (senderName.isBlank()) {
                        senderName = message.path("creatorName").asText("");
                    }
                    return new WorkgroupMessagePreview(detail.path("session").path("sessionName").asText(""),
                        senderName, speaker.path("type").asText("UNKNOWN")
                            .toUpperCase(java.util.Locale.ROOT),
                        message.path("content").asText(""), message.path("resourceList"),
                        message.path("attachments").isArray() && !message.path("attachments").isEmpty());
                }
            }
            return null;
        } catch (ResponseStatusException error) {
            LOG.error("Message preview access failed", error);
            if (error.getStatusCode().equals(HttpStatus.FORBIDDEN)
                || error.getStatusCode().equals(HttpStatus.NOT_FOUND)) {
                return null;
            }
            throw error;
        }
    }

    /** 损坏元数据只影响摘要补充；异常可能包含正文，因此按正文日志禁令仅记录异常类型。 */
    private JsonNode metadata(String value) {
        if (value == null || value.isBlank()) {
            return json.createObjectNode();
        }
        try {
            JsonNode parsed = json.readTree(value);
            return parsed != null && parsed.isObject() ? parsed : json.createObjectNode();
        } catch (java.io.IOException error) {
            LOG.error("Message preview metadata invalid, exceptionType={}", error.getClass().getSimpleName());
            return json.createObjectNode();
        }
    }

    /** 只根据结构化 HUMAN 资源及明确账号 ID 判断提及，不按名称或普通正文猜测。 */
    public boolean mentioned(WorkgroupMessageQuery notification) {
        JsonNode resources;
        try {
            if (modes.isSharedDataTenant(notification.enterpriseId())) {
                var message = messages.selectByMessageId(notification.messageId());
                if (message == null || message.getMetadata() == null) return false;
                resources = json.readTree(message.getMetadata()).path("resourceList");
            } else {
                JsonNode context = node.request(new TenantRequestContext(notification.accountId(),
                    notification.enterpriseId(), "MEMBER"), "GET", "/internal/v1/group-chats/"
                    + notification.sessionId() + "/messages/" + notification.messageId() + "/context",
                    null, new TypeReference<JsonNode>() { });
                resources = json.createArrayNode();
                for (JsonNode message : context.path("messages")) {
                    if (Long.toString(notification.messageId()).equals(message.path("messageId").asText())) {
                        resources = message.path("resourceList");
                    }
                }
            }
            for (JsonNode resource : resources) {
                if ("HUMAN".equals(resource.path("resourceType").asText())
                    && Long.toString(notification.accountId()).equals(resource.path("resourceId").asText())) return true;
            }
            return false;
        } catch (java.io.IOException error) {
            throw new IllegalStateException("Invalid message resource metadata");
        }
    }

}
