package com.iwhalecloud.byai.state.domain.mobilepush;

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
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class MobilePushPublisherTest {
    @Test
    void offlineMembersAreNotifiedForSharedAndTenantMessagesWithoutChangingBroadcastResult() {
        SessionMemberService members = mock(SessionMemberService.class);
        ChannelManager channels = mock(ChannelManager.class);
        SessionService sessions = mock(SessionService.class);
        MobilePushService push = mock(MobilePushService.class);
        GroupChatEventPublisher publisher = new GroupChatEventPublisher(members, channels);
        ReflectionTestUtils.setField(publisher, "sessionService", sessions);
        ReflectionTestUtils.setField(publisher, "mobilePush", push);
        ByaiSession group = new ByaiSession();
        group.setEnterpriseId(7L);
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjId(22L);
        when(sessions.findById(30L)).thenReturn(group);
        when(members.findSessionMembers(30L, "USER", null)).thenReturn(List.of(member));
        when(channels.getChannels(22L)).thenReturn(Set.of());
        JSONObject event = new JSONObject(Map.of("event", "MESSAGE_CREATED", "sessionId", "30", "messageId", "40"));
        assertThat(publisher.publish(30L, event, null)).isZero();
        verify(push).notifyMembers(7, event, List.of(22L));
        assertThat(publisher.publishTenantMembers(new TenantRequestContext(22, 8, "MEMBER"), event,
            List.of(Map.of("memObjType", "USER", "memObjId", "22"),
                Map.of("memObjType", "AGENT", "memObjId", "23")))).isZero();
        verify(push).notifyMembers(8, event, List.of(22L));
        doThrow(new IllegalStateException("executor unavailable")).when(push).notifyMembers(anyLong(), any(), any());
        assertThat(publisher.publish(30L, event, null)).isZero();
    }
}
