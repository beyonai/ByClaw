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

/** 向真人成员的在线 WebSocket 广播，同时发布已提交消息的通用事实。 */
@Slf4j
@Service
public class GroupChatEventPublisher {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.session.service.SessionService sessionService;
    private final SessionMemberService memberService;
    private final ChannelManager channelManager;

    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService multiDeviceBroadcastService;

    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.session.service.SessionExtService sessionExtService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private TenantNodeClient tenantNodeClient;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupMessageEvents messageEvents;

    public GroupChatEventPublisher(SessionMemberService memberService, ChannelManager channelManager) {
        this.memberService = memberService;
        this.channelManager = channelManager;
    }

    /** 群成员由服务端解析，返回值只统计本机投递；其他实例通过既有 Redis 广播异步发送。 */
    public int publish(Long sessionId, JSONObject event, Channel excludedChannel) {
        if (sessionId == null || event == null) {
            return 0;
        }
        Long groupEnterpriseId = null;
        Long businessEnterpriseId = null;
        if (sessionService != null) {
            com.iwhalecloud.byai.manager.entity.session.ByaiSession session = sessionService.findById(sessionId);
            if (session == null || (!"GROUP_DISSOLVED".equals(event.getString("event"))
                && com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService
                .DISSOLVED_STATE.equals(session.getState()))) {
                return 0;
            }
            groupEnterpriseId = session.getEnterpriseId();
            businessEnterpriseId = resolveBusinessEnterpriseId(sessionId, groupEnterpriseId);
        }
        int sent = 0;
        List<ByaiSessionMember> members = memberService.findSessionMembers(sessionId, MemObjType.USER.name(), null);
        // External facts cover all real members, including users without an online WebSocket.
        publishCommitted(groupEnterpriseId, event, members.stream().map(ByaiSessionMember::getMemObjId).toList());
        for (ByaiSessionMember member : members) {
            // 群主交接提示只推送给新群主的在线设备。
            if ("OWNERSHIP_TRANSFERRED".equals(event.getString("event"))
                && !String.valueOf(member.getMemObjId()).equals(event.getString("recipientUserId"))) continue;
            sent += multiDeviceBroadcastService.broadcastRawToUserInScope(member.getMemObjId(),
                businessEnterpriseId, event, excludedChannel);
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
        JSONObject deliveryEvent = mutableCopy(event);
        deliveryEvent.put("enterpriseId", String.valueOf(tenant.enterpriseId()));
        int sent = 0;
        List<Long> recipientIds = new java.util.ArrayList<>();
        for (Object value : members) {
            if (!(value instanceof Map<?, ?> member) || !"USER".equals(member.get("memObjType"))) continue;
            Object rawId = member.get("memObjId");
            if ("OWNERSHIP_TRANSFERRED".equals(event.getString("event"))
                && !String.valueOf(rawId).equals(event.getString("recipientUserId"))) continue;
            if (rawId == null || !rawId.toString().matches("[1-9][0-9]*")) continue;
            recipientIds.add(Long.valueOf(rawId.toString()));
            sent += multiDeviceBroadcastService.broadcastRawToUserInScope(Long.valueOf(rawId.toString()),
                tenant.enterpriseId(), deliveryEvent, null);
        }
        publishCommitted(tenant.enterpriseId(), event, recipientIds);
        return sent;
    }
    /** Only the forwarding service supplies freshly bound USER recipients; completion means enqueue, never client receipt. */
    public void publishForwardMembers(long enterpriseId,List<Long> recipientIds,JSONObject event) {
        if(enterpriseId<=0||event==null)throw new IllegalArgumentException("FORWARD_INVALID_DELIVERY");
        // Callers may pass JSONObject instances backed by immutable maps (for example Map.of in tests).
        // Keep the committed event immutable from the caller's perspective while adding delivery metadata.
        JSONObject deliveryEvent = mutableCopy(event);
        deliveryEvent.put("enterpriseId",Long.toString(enterpriseId));
        // The message is already committed; socket delivery failures cannot suppress external facts.
        publishCommitted(enterpriseId, event, recipientIds);
        List<io.netty.channel.ChannelFuture> sends=new java.util.ArrayList<>();
        try {
            for(Long id:new java.util.LinkedHashSet<>(recipientIds)) {
                multiDeviceBroadcastService.publishRawToRemoteUser(id, enterpriseId, deliveryEvent);
                for(Channel channel:channelManager.getChannels(id)) {
                    if(!channel.isActive()||!Objects.equals(Long.toString(enterpriseId),channel.attr(Constant.ATT_ENTERPRISE_ID).get()))continue;
                    sends.add(channel.writeAndFlush(new TextWebSocketFrame(deliveryEvent.toJSONString())));
                }
            }
            long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
            for(var send:sends) {
                long left=deadline-System.nanoTime();
                if(left<=0||!send.await(left,java.util.concurrent.TimeUnit.NANOSECONDS)||!send.isSuccess())throw new IllegalStateException("FORWARD_DELIVERY_UNAVAILABLE");
            }
        } catch(InterruptedException interrupted) {
            Thread.currentThread().interrupt();throw new IllegalStateException("FORWARD_DELIVERY_UNAVAILABLE");
        } catch(RuntimeException failure) {
            throw new IllegalStateException("FORWARD_DELIVERY_UNAVAILABLE");
        }
    }

    /** 个人群的存储企业不代表业务归属；后台完成通知必须读取持久化归属。 */
    private Long resolveBusinessEnterpriseId(Long sessionId, Long storageEnterpriseId) {
        var ownership = sessionExtService.findOneByExtParamCode(sessionId,
            com.iwhalecloud.byai.common.quota.SharedQuotaAdmission.BUSINESS_ENTERPRISE_EXT);
        if (ownership == null) {
            return storageEnterpriseId == null || storageEnterpriseId <= 0 ? null : storageEnterpriseId;
        }
        String value = ownership.getExtParamValue();
        if ("NONE".equals(value)) {
            return null;
        }
        // 无法确认归属时禁止降级为个人广播，避免向错误的租户通道投递。
        if (value == null || !value.matches("[1-9][0-9]*")
            || !value.equals(String.valueOf(storageEnterpriseId))) {
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "groupchat.quota.enterprise.unconfirmed");
        }
        return storageEnterpriseId;
    }

    /** External consumers cannot change an already committed message or its existing ACK/broadcast semantics. */
    private void publishCommitted(Long enterpriseId, JSONObject event, List<Long> recipientIds) {
        if (messageEvents == null || enterpriseId == null) {
            return;
        }
        try {
            messageEvents.committed(enterpriseId, event, recipientIds);
        } catch (RuntimeException error) {
            log.warn("Workgroup event submission failed, enterpriseId={}", enterpriseId);
        }
    }

    private static JSONObject mutableCopy(JSONObject event) {
        JSONObject copy = new JSONObject();
        copy.putAll(event);
        return copy;
    }
}
