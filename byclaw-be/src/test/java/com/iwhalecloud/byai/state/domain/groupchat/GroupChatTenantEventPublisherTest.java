package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

class GroupChatTenantEventPublisherTest {
    @Test
    void broadcastsOnlyToCurrentTenantHumanMembers() {
        TenantNodeClient node = mock(TenantNodeClient.class);
        ChannelManager channels = mock(ChannelManager.class);
        GroupChatEventPublisher publisher = new GroupChatEventPublisher(mock(SessionMemberService.class), channels);
        ReflectionTestUtils.setField(publisher, "tenantNodeClient", node);
        TenantRequestContext tenant = new TenantRequestContext(7L, 10L, "MEMBER");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), isNull(), any()))
            .thenReturn(Map.of("members", List.of(
                Map.of("memObjType", "USER", "memObjId", "7"),
                Map.of("memObjType", "AGENT", "memObjId", "42"))));
        EmbeddedChannel selected = new EmbeddedChannel();
        selected.attr(Constant.ATT_ENTERPRISE_ID).set("10");
        EmbeddedChannel otherTenant = new EmbeddedChannel();
        otherTenant.attr(Constant.ATT_ENTERPRISE_ID).set("11");
        when(channels.getChannels(7L)).thenReturn(Set.of(selected, otherTenant));
        JSONObject event = new JSONObject();
        event.put("event", "MESSAGE_CREATED");

        assertThat(publisher.publishTenant(tenant, 30L, event)).isEqualTo(1);
        TextWebSocketFrame frame = selected.readOutbound();
        assertThat(frame.text()).contains("MESSAGE_CREATED").contains("\"enterpriseId\":\"10\"");
        assertThat((Object) otherTenant.readOutbound()).isNull();
        frame.release();
        selected.finishAndReleaseAll();
        otherTenant.finishAndReleaseAll();
    }
}
