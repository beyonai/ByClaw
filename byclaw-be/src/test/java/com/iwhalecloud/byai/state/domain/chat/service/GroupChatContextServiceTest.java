package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatContextTokenService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class GroupChatContextServiceTest {

    private ByaiMessageMapper messageMapper;

    private SessionService sessionService;

    private SsResourceService resourceService;

    private GroupChatContextService service;

    @BeforeEach
    void setUp() {
        messageMapper = mock(ByaiMessageMapper.class);
        sessionService = mock(SessionService.class);
        resourceService = mock(SsResourceService.class);
        service = new GroupChatContextService(messageMapper, sessionService, resourceService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(100L);
        loginInfo.setUserCode("user-100");
        loginInfo.setUserName("张三");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void loadReturnsMessagesBeforeBoundaryInStableOrderWithSpeakerIdentity() {
        ByaiSession session = new ByaiSession();
        session.setSessionId(3L);
        session.setCreatorId(100L);
        when(sessionService.findById(3L)).thenReturn(session);

        ByaiMessage user = message(10L, 1, "用户问题", 100L);
        user.setCreatorId(100L);
        user.setCreatorName("张三");
        ByaiMessage agent = message(20L, 2, "A 的回答", 200L);
        agent.setResComIds("[1001]");
        when(messageMapper.countVisibleBeforeMessageId(3L, 30L)).thenReturn(2L);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 60))
            .thenReturn(Arrays.asList(agent, user));

        SsResource resource = new SsResource();
        resource.setResourceId(1001L);
        resource.setResourceName("Agent A");
        when(resourceService.findById(1001L)).thenReturn(resource);

        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3");
        request.setBeforeMessageId("30");
        request.setMaxMessages(60);
        request.setMaxCharacters(30_000);

        GroupChatContextResponse response = service.load(request);

        assertThat(response.getConversationKey()).isEqualTo("3");
        assertThat(response.getSnapshot().getBeforeMessageId()).isEqualTo("30");
        assertThat(response.getMessages()).extracting(GroupChatContextResponse.Message::getMessageId)
            .containsExactly("10", "20");
        assertThat(response.getMessages().get(0).getSpeaker().getUserCode()).isEqualTo("user-100");
        assertThat(response.getMessages().get(1).getSpeaker().getAgentId()).isEqualTo("1001");
        assertThat(response.getMessages().get(1).getSpeaker().getAgentName()).isEqualTo("Agent A");
        assertThat(response.getTruncation().getTruncated()).isFalse();
    }

    @Test
    void signedParentContextRequiresTheBoundChildSession() {
        SessionMemberService memberService = mock(SessionMemberService.class);
        GroupChatContextTokenService tokenService = mock(GroupChatContextTokenService.class);
        service = new GroupChatContextService(messageMapper, sessionService, resourceService, memberService,
            tokenService);
        ByaiSession session = new ByaiSession();
        session.setSessionId(3L);
        when(sessionService.findById(3L)).thenReturn(session);
        when(tokenService.verify("signed-context-token")).thenReturn(Map.of(
            "scene", "GROUP_CHAT_CONTEXT",
            "groupSessionId", 3L,
            "childSessionId", 500L,
            "initiatorUserId", 100L,
            "targetAgentId", 200L,
            "boundaryMessageId", 30L));
        when(messageMapper.countVisibleBeforeMessageId(3L, 30L)).thenReturn(0L);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 60)).thenReturn(Collections.emptyList());

        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3");
        request.setBeforeMessageId("30");
        request.setContextToken("signed-context-token");
        request.setChildSessionId(500L);
        request.setInitiatorUserId(100L);
        request.setTargetAgentId(200L);

        assertThat(service.load(request).getConversationKey()).isEqualTo("3");

        request.setChildSessionId(501L);
        assertThatThrownBy(() -> service.load(request))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("Conversation not found");
    }

    @Test
    void historyAndReplyRestoreMemberResourcesWithoutLosingLongIds() {
        ByaiSession session = new ByaiSession();
        session.setSessionId(3L);
        session.setCreatorId(100L);
        when(sessionService.findById(3L)).thenReturn(session);
        ByaiMessage original = message(10L, 1, "{{HUMAN_9223372036854775806}} 确认下", 100L);
        original.setMetadata("{\"clientRequestId\":\"retry-1\",\"resourceList\":[{\"id\":\"HUMAN_9223372036854775806\","
            + "\"resourceId\":\"9223372036854775806\",\"resourceName\":\"用户A\",\"resourceType\":\"HUMAN\"}]}");
        ByaiMessage reply = message(20L, 1, "好的", 200L);
        reply.setMessageRef(10L);
        reply.setMetadata("{\"resourceList\":[{\"id\":\"DIG_EMPLOYEE_3001\","
            + "\"resourceId\":\"3001\",\"resourceName\":\"数字员工\",\"resourceType\":\"DIG_EMPLOYEE\"}]}");
        when(messageMapper.selectByMessageId(10L)).thenReturn(original);
        when(messageMapper.countVisibleBeforeMessageId(3L, 30L)).thenReturn(2L);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 60)).thenReturn(Arrays.asList(reply, original));
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3");
        request.setBeforeMessageId("30");
        GroupChatContextResponse response = service.load(request);
        assertThat(response.getMessages().get(0).getClientRequestId()).isEqualTo("retry-1");
        reply.setMetadata("{\"taskId\":\"9007199254740993\",\"kind\":\"TASK_ACK\"}");
        GroupChatContextResponse withTask = service.load(request);
        assertThat(withTask.getMessages().get(1).getTaskId()).isEqualTo("9007199254740993");
        assertThat(withTask.getMessages().get(1).getKind()).isEqualTo("TASK_ACK");
        assertThat(withTask.getMessages().get(0).getTaskId()).isNull();
        assertThat(response.getMessages().get(0).getResourceList().get(0).getResourceId())
            .isEqualTo("9223372036854775806");
        assertThat(response.getMessages().get(1).getResourceList().get(0).getResourceName()).isEqualTo("数字员工");
        assertThat(response.getMessages().get(1).getReplyTo().getResourceList().get(0).getResourceName())
            .isEqualTo("用户A");
        original.setMetadata("invalid-json");
        reply.setMetadata(null);
        GroupChatContextResponse legacy = service.load(request);
        assertThat(legacy.getMessages().get(0).getResourceList()).isEmpty();
        assertThat(legacy.getMessages().get(1).getResourceList()).isEmpty();
        assertThat(legacy.getMessages().get(1).getReplyTo().getResourceList()).isEmpty();
    }

    @Test
    void restoresLegacyGroupAgentIdentityInHistoryAndQuotedReplies() {
        ByaiSession session = new ByaiSession();
        session.setSessionId(3L);
        session.setCreatorId(100L);
        when(sessionService.findById(3L)).thenReturn(session);
        SsResource resource = new SsResource();
        resource.setResourceName("PPT创作助理(官方认证)");
        when(resourceService.findById(20047408L)).thenReturn(resource);
        ByaiMessage agent = message(10L, 2, "技能介绍", 100L);
        agent.setMetadata("{\"scene\":\"GROUP_CHAT\",\"targetAgentId\":\"20047408\"}");
        ByaiMessage reply = message(20L, 1, "收到", 200L);
        reply.setMessageRef(10L);
        when(messageMapper.selectByMessageId(10L)).thenReturn(agent);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 60)).thenReturn(Arrays.asList(reply, agent));
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3");
        request.setBeforeMessageId("30");

        GroupChatContextResponse response = service.load(request);
        assertThat(response.getMessages().get(0).getSpeaker().getAgentId()).isEqualTo("20047408");
        assertThat(response.getMessages().get(0).getSpeaker().getAgentName()).isEqualTo("PPT创作助理(官方认证)");
        assertThat(response.getMessages().get(1).getReplyTo().getSpeaker().getAgentId()).isEqualTo("20047408");

        for (String kind : Arrays.asList("TASK_ACK", "TASK_RESULT")) {
            agent.setCreatorId(20047408L);
            agent.setMetadata("{\"scene\":\"GROUP_CHAT\",\"kind\":\"" + kind + "\"}");
            assertThat(service.load(request).getMessages().get(0).getSpeaker().getAgentId()).isEqualTo("20047408");
        }
        agent.setMetadata("{\"scene\":\"GROUP_CHAT\",\"targetAgentId\":\"invalid\"}");
        agent.setResComIds("[20047408]");
        assertThat(service.load(request).getMessages().get(0).getSpeaker().getAgentId()).isEqualTo("20047408");
        agent.setResComIds(null);
        agent.setMetadata("invalid-json");
        assertThat(service.load(request).getMessages().get(0).getSpeaker().getAgentId()).isEqualTo("unknown");
    }

    private ByaiMessage message(Long messageId, int usage, String content, long createdAt) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(messageId);
        message.setSessionId(3L);
        message.setUsage(usage);
        message.setMessageContent(content);
        message.setCreateTime(new Date(createdAt));
        return message;
    }
}
