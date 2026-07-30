package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Arrays;
import java.util.Date;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
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
