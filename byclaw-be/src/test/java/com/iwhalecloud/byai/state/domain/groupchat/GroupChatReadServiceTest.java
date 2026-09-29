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

import java.util.Date;
import java.util.List;
import java.nio.charset.StandardCharsets;

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
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberSummary;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class GroupChatReadServiceTest {

    @Test
    void memberSummaryQueryReadsAvatarForBothMemberTypes() throws Exception {
        try (var stream = getClass().getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/session/ByaiSessionMemberMapper.xml")) {
            assertThat(stream).isNotNull();
            String mapper = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            assertThat(mapper).contains("WHEN member.mem_obj_type = 'AGENT' THEN resource.avatar")
                .contains("WHEN member.mem_obj_type = 'USER' THEN user_info.thumbnail_uri")
                .contains("END AS avatar");
        }
    }

    private final ByaiGroupChatMentionMapper mentionMapper = mock(ByaiGroupChatMentionMapper.class);
    private final ByaiSessionMemberMapper memberMapper = mock(ByaiSessionMemberMapper.class);
    private final ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService authorizationService = mock(GroupChatAuthorizationService.class);
    private final MultiDeviceBroadcastService broadcastService = mock(MultiDeviceBroadcastService.class);
    private final GroupChatContextService contextService = new GroupChatContextService(messageMapper, null, null);
    private final GroupChatReadService service = new GroupChatReadService(mentionMapper, memberMapper, messageMapper,
        authorizationService, broadcastService, contextService);

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
        GroupChatMemberSummary member = new GroupChatMemberSummary();
        member.setSessionId(10L);
        member.setMemObjType("AGENT");
        member.setMemObjId(20010807L);
        member.setMemName("官网助手");
        member.setAvatar("avatar.png");
        when(memberMapper.findGroupMemberSummaries(List.of(10L), 9)).thenReturn(List.of(member));
        try {
            PageInfo<GroupChatListItemResponse> result = service.listMyGroups(1, 20);
            assertThat(result.getPageNum()).isEqualTo(1);
            assertThat(result.getPageSize()).isEqualTo(20);
            assertThat(result.getTotal()).isEqualTo(21L);
            assertThat(result.getList().get(0).getLatestMessageContent()).isEqualTo("@官网助手 开发官网，@张三");
            assertThat(result.getList().get(0).getLatestMessageAttachments()).isEmpty();
            assertThat(result.getList().get(0).getMembers()).containsExactly(member);
            assertThat(item.getLatestMessageMetadata()).isEqualTo(storedMetadata);
            assertThat(new ObjectMapper().writeValueAsString(item)).doesNotContain("latestMessageMetadata", "resourceList");
            assertThat(JSONObject.toJSONString(item)).doesNotContain("latestMessageMetadata", "resourceList");
            verifyNoInteractions(messageMapper, broadcastService);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void recalledLatestMessageKeepsListPositionWithoutLeakingContent() throws Exception {
        GroupChatListItemResponse item = new GroupChatListItemResponse();
        item.setSessionId(10L);
        item.setLatestMessageId(20L);
        item.setLatestMessageTime(new Date(100));
        item.setLatestMessageContent("SECRET");
        item.setLatestMessageMetadata("SECRET");
        item.setLatestMessageRelatedResources("{\"files\":[{\"fileId\":\"private\",\"fileName\":\"secret.txt\"}]}");
        item.setLatestMessageRecalledAt(new Date(200));
        item.setLatestMessageRecalledBy(30L);
        when(mentionMapper.selectMyGroups(30L)).thenAnswer(invocation -> {
            Page<GroupChatListItemResponse> page = PageHelper.getLocalPage();
            page.add(item);
            return page;
        });
        when(memberMapper.findGroupMemberSummaries(List.of(10L), 9)).thenReturn(List.of());
        try {
            var result = service.listMyGroups(1, 20).getList().get(0);
            assertThat(result.isLatestMessageRecalled()).isTrue();
            assertThat(result.getLatestMessageId()).isEqualTo(20L);
            assertThat(result.getLatestMessageTime()).isEqualTo(new Date(100));
            assertThat(result.getLatestMessageContent()).endsWith(" 撤回了一条消息");
            assertThat(result.getLatestMessageAttachments()).isEmpty();
            assertThat(new ObjectMapper().writeValueAsString(result)).doesNotContain("SECRET");
            verifyNoInteractions(messageMapper, broadcastService);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void listIncludesAttachmentsFromLatestMessageOnly() throws Exception {
        GroupChatListItemResponse item = new GroupChatListItemResponse();
        item.setSessionId(10L);
        item.setLatestMessageId(20L);
        item.setLatestMessageRelatedResources("""
            {"files":[{"fileId":"123","fileName":"report.pdf","fileUrl":"/report.pdf","fileType":"application/pdf"}]}
            """);
        when(mentionMapper.selectMyGroups(30L)).thenAnswer(invocation -> {
            Page<GroupChatListItemResponse> page = PageHelper.getLocalPage();
            page.add(item);
            return page;
        });
        try {
            var result = service.listMyGroups(1, 20).getList().get(0);
            assertThat(result.getLatestMessageAttachments()).hasSize(1);
            assertThat(result.getLatestMessageAttachments().get(0).getFileId()).isEqualTo("123");
            assertThat(result.getLatestMessageAttachments().get(0).getFileName()).isEqualTo("report.pdf");
            assertThat(result.getLatestMessageAttachments().get(0).getMediaType()).isEqualTo("application/pdf");
            assertThat(new ObjectMapper().writeValueAsString(result)).contains("latestMessageAttachments")
                .doesNotContain("latestMessageRelatedResources");
            verifyNoInteractions(messageMapper);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void listIncludesTaskResultFilesFromLatestMessageMetadata() {
        GroupChatListItemResponse item = new GroupChatListItemResponse();
        item.setSessionId(10L);
        item.setLatestMessageId(21L);
        item.setLatestMessageMetadata("""
            {"scene":"GROUP_CHAT","kind":"TASK_RESULT","files":[
              {"fileName":"result.txt","filePath":"/results/result.txt","cloudResourceId":"cloud-1"}
            ]}
            """);
        when(mentionMapper.selectMyGroups(30L)).thenAnswer(invocation -> {
            Page<GroupChatListItemResponse> page = PageHelper.getLocalPage();
            page.add(item);
            return page;
        });
        try {
            var attachments = service.listMyGroups(1, 20).getList().get(0).getLatestMessageAttachments();
            assertThat(attachments).hasSize(1);
            assertThat(attachments.get(0).getFileName()).isEqualTo("result.txt");
            assertThat(attachments.get(0).getFilePath()).isEqualTo("/results/result.txt");
            assertThat(attachments.get(0).getCloudResourceId()).isEqualTo("cloud-1");
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
        state.setUnreadCount(4);
        state.setUnreadMentionCount(2);
        state.setLatestMentionMessageId(25L);
        when(mentionMapper.selectMentionState(10L, 30L)).thenReturn(state);

        GroupChatReadStateResponse response = service.markRead(10L, 20L);

        verify(memberMapper).advanceReadCursor(eq(11L),
            eq(20L), any());
        assertThat(response.getLastReadMessageId()).isEqualTo(20L);
        assertThat(response.getUnreadCount()).isEqualTo(4);
        assertThat(response.getUnreadMentionCount()).isEqualTo(2);
        assertThat(response.isHasUnreadMention()).isTrue();
        ArgumentCaptor<JSONObject> eventCaptor = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcastService).broadcastRawToUser(eq(30L), eventCaptor.capture(),
            isNull());
        assertThat(eventCaptor.getValue().getString("sessionId")).isEqualTo("10");
        assertThat(eventCaptor.getValue().getString("lastReadMessageId")).isEqualTo("20");
        assertThat(eventCaptor.getValue().getLongValue("unreadCount")).isEqualTo(4L);
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
