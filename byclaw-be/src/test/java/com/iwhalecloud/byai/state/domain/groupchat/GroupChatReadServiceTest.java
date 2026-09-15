package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.alibaba.fastjson.JSONObject;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateResponse;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class GroupChatReadServiceTest {
    private final ByaiGroupChatMentionMapper mentionMapper = mock(ByaiGroupChatMentionMapper.class);
    private final ByaiSessionMemberMapper memberMapper = mock(ByaiSessionMemberMapper.class);
    private final ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService authorizationService = mock(GroupChatAuthorizationService.class);
    private final MultiDeviceBroadcastService broadcastService = mock(MultiDeviceBroadcastService.class);
    private final GroupChatReadService service = new GroupChatReadService(mentionMapper, memberMapper, messageMapper,
        authorizationService, broadcastService);

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(30L);
        CurrentUserHolder.setLoginInfo(login);
        ByaiSession group = new ByaiSession();
        group.setSessionId(10L);
        when(authorizationService.requireGroup(10L)).thenReturn(group);
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(11L);
        when(authorizationService.requireCurrentUserMember(10L)).thenReturn(member);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void listOnlyNormalizesLatestMessageContentAndKeepsPagination() throws Exception {
        GroupChatListItemResponse item = new GroupChatListItemResponse();
        item.setSessionId(10L);
        item.setLatestMessageId(20L);
        item.setLatestMessageContent("{{DIG_EMPLOYEE_20010807}} 开发官网，[@张三](uid=HUMAN_123)");
        item.setLatestMessageMetadata("""
            {"resourceList":[{"resourceType":"DIG_EMPLOYEE","resourceId":"20010807","resourceName":"官网助手"}]}
            """);
        String storedMetadata = item.getLatestMessageMetadata();
        when(mentionMapper.selectMyGroups(30L)).thenAnswer(invocation -> {
            Page<GroupChatListItemResponse> page = PageHelper.getLocalPage();
            page.setTotal(21L);
            page.add(item);
            return page;
        });
        try {
            PageInfo<GroupChatListItemResponse> result = service.listMyGroups(1, 20);
            assertThat(result.getPageNum()).isEqualTo(1);
            assertThat(result.getPageSize()).isEqualTo(20);
            assertThat(result.getTotal()).isEqualTo(21L);
            assertThat(result.getList().get(0).getLatestMessageContent()).isEqualTo("@官网助手 开发官网，@张三");
            assertThat(item.getLatestMessageMetadata()).isEqualTo(storedMetadata);
            assertThat(new ObjectMapper().writeValueAsString(item)).doesNotContain("latestMessageMetadata", "resourceList");
            assertThat(JSONObject.toJSONString(item)).doesNotContain("latestMessageMetadata", "resourceList");
            verifyNoInteractions(messageMapper, memberMapper, broadcastService);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void advancesCursorAndReturnsRemainingMentionState() {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(20L);
        message.setSessionId(10L);
        when(messageMapper.selectByMessageId(20L)).thenReturn(message);
        GroupChatListItemResponse state = new GroupChatListItemResponse();
        state.setLastReadMessageId(20L);
        state.setUnreadMentionCount(2);
        state.setLatestMentionMessageId(25L);
        when(mentionMapper.selectMentionState(10L, 30L)).thenReturn(state);

        GroupChatReadStateResponse response = service.markRead(10L, 20L);

        verify(memberMapper).advanceReadCursor(eq(11L),
            eq(20L), any());
        assertThat(response.getLastReadMessageId()).isEqualTo(20L);
        assertThat(response.getUnreadMentionCount()).isEqualTo(2);
        assertThat(response.isHasUnreadMention()).isTrue();
        ArgumentCaptor<JSONObject> eventCaptor = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcastService).broadcastRawToUser(eq(30L), eventCaptor.capture(),
            isNull());
        assertThat(eventCaptor.getValue().getString("sessionId")).isEqualTo("10");
        assertThat(eventCaptor.getValue().getString("lastReadMessageId")).isEqualTo("20");
        assertThat(eventCaptor.getValue().getLongValue("unreadMentionCount")).isEqualTo(2L);
    }

    @Test
    void rejectsMessageFromAnotherGroupBeforeUpdatingCursor() {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(20L);
        message.setSessionId(99L);
        when(messageMapper.selectByMessageId(20L)).thenReturn(message);

        assertThatThrownBy(() -> service.markRead(10L, 20L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Read cursor message is not in this group");

        verify(memberMapper, never()).advanceReadCursor(any(), any(), any());
    }

    @Test
    void serializesDerivedUnreadFlagWithTheFrontendContractName() throws Exception {
        GroupChatListItemResponse item = new GroupChatListItemResponse();
        item.setSessionId(9007199254740993L);
        item.setLatestMessageId(9007199254740995L);
        item.setUnreadMentionCount(1);

        assertThat(new ObjectMapper().writeValueAsString(item))
            .contains("\"sessionId\":\"9007199254740993\"")
            .contains("\"latestMessageId\":\"9007199254740995\"")
            .contains("\"hasUnreadMention\":true");
    }
}
