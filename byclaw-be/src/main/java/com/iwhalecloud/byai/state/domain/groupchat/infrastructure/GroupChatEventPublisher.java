package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import lombok.extern.slf4j.Slf4j;

/** 向群内用户的所有在线设备广播事件。Agent 成员没有 WebSocket 身份，不参与设备推送。 */
@Slf4j
@Service
public class GroupChatEventPublisher {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.session.service.SessionService sessionService;
    private final SessionMemberService memberService;
    private final ChannelManager channelManager;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private TenantNodeClient tenantNodeClient;

    public GroupChatEventPublisher(SessionMemberService memberService, ChannelManager channelManager) {
        this.memberService = memberService;
        this.channelManager = channelManager;
    }

    public int publish(Long sessionId, JSONObject event, Channel excludedChannel) {
        if (sessionId == null || event == null) {
            return 0;
        }
        if (sessionService != null && !"GROUP_DISSOLVED".equals(event.getString("event"))) {
            com.iwhalecloud.byai.manager.entity.session.ByaiSession session = sessionService.findById(sessionId);
            if (session == null || com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService
                .DISSOLVED_STATE.equals(session.getState())) return 0;
        }
        int sent = 0;
        List<ByaiSessionMember> members = memberService.findSessionMembers(sessionId, MemObjType.USER.name(), null);
        for (ByaiSessionMember member : members) {
            // 群主交接提示只推送给新群主的在线设备。
            if ("OWNERSHIP_TRANSFERRED".equals(event.getString("event"))
                && !String.valueOf(member.getMemObjId()).equals(event.getString("recipientUserId"))) continue;
            for (Channel channel : channelManager.getChannels(member.getMemObjId())) {
                if (channel.equals(excludedChannel) || !channel.isActive()) {
                    continue;
                }
                try {
                    channel.writeAndFlush(new TextWebSocketFrame(event.toJSONString()));
                    sent++;
                }
                catch (Exception error) {
                    log.warn("群聊事件广播失败, sessionId={}, userId={}", sessionId, member.getMemObjId(), error);
                }
            }
        }
        return sent;
    }

    /** Tenant group membership is authoritative in the Node, not in the shared session tables. */
    public int publishTenant(TenantRequestContext tenant, Long sessionId, JSONObject event) {
        if (tenantNodeClient == null) throw new IllegalStateException("tenant Node client unavailable");
        Map<String, Object> detail = tenantNodeClient.request(tenant, "GET",
            "/internal/v1/group-chats/" + sessionId, null, new TypeReference<Map<String, Object>>() { });
        Object rawMembers = detail.get("members");
        if (!(rawMembers instanceof List<?> members)) throw new IllegalStateException("tenant group members unavailable");
        return publishTenantMembers(tenant, event, members);
    }

    /** 使用写入前已鉴权的成员快照，离群和解散提交后仍可通知原成员。 */
    public int publishTenantMembers(TenantRequestContext tenant, JSONObject event, List<?> members) {
        event.put("enterpriseId", String.valueOf(tenant.enterpriseId()));
        int sent = 0;
        for (Object value : members) {
            if (!(value instanceof Map<?, ?> member) || !"USER".equals(member.get("memObjType"))) continue;
            Object rawId = member.get("memObjId");
            if ("OWNERSHIP_TRANSFERRED".equals(event.getString("event"))
                && !String.valueOf(rawId).equals(event.getString("recipientUserId"))) continue;
            if (rawId == null || !rawId.toString().matches("[1-9][0-9]*")) continue;
            for (Channel channel : channelManager.getChannels(Long.valueOf(rawId.toString()))) {
                if (!channel.isActive() || !Objects.equals(String.valueOf(tenant.enterpriseId()),
                    channel.attr(Constant.ATT_ENTERPRISE_ID).get())) continue;
                try {
                    channel.writeAndFlush(new TextWebSocketFrame(event.toJSONString()));
                    sent++;
                }
                catch (Exception error) {
                    log.warn("租户工作组事件广播失败, sessionId={}, userId={}", event.getString("sessionId"), rawId, error);
                }
            }
        }
        return sent;
    }
}
