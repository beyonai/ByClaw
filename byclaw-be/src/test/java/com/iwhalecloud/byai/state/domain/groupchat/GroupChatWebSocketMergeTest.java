package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.TenantGroupAgentDispatcher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatWebSocketService;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

/** 合并回归：租户路由和统一回执边界必须同时保留。 */
class GroupChatWebSocketMergeTest {
    private final GroupChatApplicationService legacy = mock(GroupChatApplicationService.class);
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final ByaiGroupChatMentionMapper memberships = mock(ByaiGroupChatMentionMapper.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final TenantGroupAgentDispatcher dispatcher = mock(TenantGroupAgentDispatcher.class);
    private final ChannelHandlerContext channel = mock(ChannelHandlerContext.class);
    private final TenantRequestContext tenant = new TenantRequestContext(7L, 10L, "MEMBER");
    private final GroupChatWebSocketService service =
        new GroupChatWebSocketService(legacy, node, memberships, events, dispatcher);

    @AfterEach
    void clearContext() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantMessageCommitsOnceAndReturnsTenantAck() {
        TenantRequestContextHolder.set(tenant);
        when(node.command(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/messages"),
            eq("30"), eq("SEND_GROUP_MESSAGE"), any(), eq("request-1")))
            .thenReturn(new CommandResult("30", "request-1", "SEND_GROUP_MESSAGE", "9001", List.of(), null));

        service.send(channel, message());

        JSONObject ack = response();
        assertThat(ack.getString("type")).isEqualTo("GROUP_CHAT_ACCEPTED");
        assertThat(ack.getString("messageId")).isEqualTo("9001");
        assertThat(ack.getString("enterpriseId")).isEqualTo(String.valueOf(tenant.enterpriseId()));
        verify(node).command(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/messages"),
            eq("30"), eq("SEND_GROUP_MESSAGE"), any(), eq("request-1"));
        verify(events).publishTenant(eq(tenant), eq(30L), any());
        verify(dispatcher).dispatch(tenant, 30L, "9001", "hello", List.of());
        verifyNoInteractions(legacy);
    }

    @Test
    void legacyMembershipStillUsesLegacyServiceUnderTenantContext() {
        TenantRequestContextHolder.set(tenant);
        when(memberships.isLegacyGroupMember(30L, tenant.userId(), tenant.enterpriseId())).thenReturn(true);
        ChatMessage message = message();
        when(legacy.acceptUserMessage(message)).thenReturn(9002L);

        service.send(channel, message);

        assertThat(response().getString("messageId")).isEqualTo("9002");
        verify(legacy).acceptUserMessage(message);
        verifyNoInteractions(node, events, dispatcher);
    }

    @Test
    void tenantStorageFailureReturnsRetryableError() {
        TenantRequestContextHolder.set(tenant);
        when(node.command(eq(tenant), eq("POST"), any(), eq("30"), eq("SEND_GROUP_MESSAGE"), any(), any()))
            .thenThrow(new DataAccessResourceFailureException("unavailable"));

        service.send(channel, message());

        JSONObject error = response();
        assertThat(error.getString("type")).isEqualTo("ERROR");
        assertThat(error.getString("code")).isEqualTo("GROUP_CHAT_STORAGE_ERROR");
        assertThat(error.getString("clientRequestId")).isEqualTo("request-1");
        verifyNoInteractions(legacy, events, dispatcher);
    }

    @Test
    void ackWriteFailureDoesNotSendASecondRejection() {
        ChatMessage message = message();
        when(legacy.acceptUserMessage(message)).thenReturn(9003L);
        when(channel.writeAndFlush(any())).thenThrow(new IllegalStateException("channel closed"));

        assertThatThrownBy(() -> service.send(channel, message))
            .isInstanceOf(IllegalStateException.class).hasMessage("channel closed");

        verify(legacy).acceptUserMessage(message);
        assertThat(response().getString("type")).isEqualTo("GROUP_CHAT_ACCEPTED");
    }

    private ChatMessage message() {
        ChatMessage message = new ChatMessage();
        message.setSessionId(30L);
        message.setChatContent("hello");
        message.setClientRequestId("request-1");
        return message;
    }

    private JSONObject response() {
        ArgumentCaptor<TextWebSocketFrame> frame = ArgumentCaptor.forClass(TextWebSocketFrame.class);
        verify(channel).writeAndFlush(frame.capture());
        try {
            return JSON.parseObject(frame.getValue().text());
        }
        finally {
            frame.getValue().release();
        }
    }
}
