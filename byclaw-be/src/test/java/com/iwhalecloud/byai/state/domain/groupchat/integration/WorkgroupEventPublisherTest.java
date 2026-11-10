package com.iwhalecloud.byai.state.domain.groupchat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupMessageEvents;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class WorkgroupEventPublisherTest {
    @Test
    void sharedAndTenantFactsIncludeOfflineRecipientsWithoutChangingSocketResults() {
        SessionMemberService members = mock(SessionMemberService.class);
        ChannelManager channels = mock(ChannelManager.class);
        SessionService sessions = mock(SessionService.class);
        WorkgroupMessageEvents messageEvents = mock(WorkgroupMessageEvents.class);
        GroupChatEventPublisher publisher = new GroupChatEventPublisher(members, channels);
        ReflectionTestUtils.setField(publisher, "sessionService", sessions);
        ReflectionTestUtils.setField(publisher, "messageEvents", messageEvents);
        ByaiSession group = new ByaiSession();
        group.setEnterpriseId(7L);
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjId(22L);
        when(sessions.findById(30L)).thenReturn(group);
        when(members.findSessionMembers(30L, "USER", null)).thenReturn(List.of(member));
        when(channels.getChannels(22L)).thenReturn(Set.of());
        JSONObject event = new JSONObject(Map.of("event", "MESSAGE_CREATED", "sessionId", "30", "messageId", "40"));
        assertThat(publisher.publish(30L, event, null)).isZero();
        verify(messageEvents).committed(7, event, List.of(22L));
        assertThat(publisher.publishTenantMembers(new TenantRequestContext(22, 8, "MEMBER"), event,
            List.of(Map.of("memObjType", "USER", "memObjId", "22"),
                Map.of("memObjType", "AGENT", "memObjId", "23")))).isZero();
        verify(messageEvents).committed(8, event, List.of(22L));
        doThrow(new IllegalStateException("executor unavailable")).when(messageEvents).committed(anyLong(), any(), any());
        assertThat(publisher.publish(30L, event, null)).isZero();
    }
    @Test
    void forwardSocketFailureCannotSuppressAlreadyCommittedFact() {
        var channels = mock(ChannelManager.class);
        var publisher = new GroupChatEventPublisher(mock(SessionMemberService.class), channels);
        var messageEvents = mock(WorkgroupMessageEvents.class);
        ReflectionTestUtils.setField(publisher, "messageEvents", messageEvents);
        var failing = new io.netty.channel.embedded.EmbeddedChannel(new io.netty.channel.ChannelOutboundHandlerAdapter() {
            @Override
            public void write(io.netty.channel.ChannelHandlerContext context, Object message, io.netty.channel.ChannelPromise promise) {
                io.netty.util.ReferenceCountUtil.release(message);
                promise.setFailure(new IllegalStateException("test transport failure"));
            }
        });
        failing.attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID).set("7");
        when(channels.getChannels(22L)).thenReturn(Set.of(failing));
        var event = new JSONObject(Map.of("event", "MESSAGE_CREATED", "sessionId", "30", "messageId", "40"));
        try {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> publisher.publishForwardMembers(7, List.of(22L), event))
                .hasMessage("FORWARD_DELIVERY_UNAVAILABLE");
            verify(messageEvents).committed(7, event, List.of(22L));
        } finally {
            failing.finishAndReleaseAll();
        }
    }

}
