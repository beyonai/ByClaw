package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.anyCollection;

import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.Map;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMessageAck;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMessageAckMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
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

    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);

    @BeforeEach
    void setUp() {
        messageMapper = mock(ByaiMessageMapper.class);
        sessionService = mock(SessionService.class);
        resourceService = mock(SsResourceService.class);
        service = new GroupChatContextService(messageMapper, sessionService, resourceService);
        ReflectionTestUtils.setField(service, "taskMapper", tasks);

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
    void topicProjectionPreservesIdentityAndNeverLoadsHiddenReplyOutsideVisibleSnapshot() {
        ByaiMessage reply = message(20L, 1, "visible reply", 100L);
        reply.setTopicId(10L);
        reply.setMessageRef(10L);
        var projected = service.toMessages(List.of(reply), Map.of()).get(0);
        assertThat(projected.getTopicId()).isEqualTo("10");
        assertThat(projected.getContent()).isEqualTo("visible reply");
        assertThat(projected.getReplyTo()).isNull();
        verify(messageMapper, never()).selectByMessageId(10L);
        ByaiMessage root = message(10L, 1, "visible root", 100L);
        projected = service.toMessages(List.of(reply), Map.of(10L, root)).get(0);
        assertThat(projected.getReplyTo().getMessageId()).isEqualTo("10");
        assertThat(projected.getReplyTo().getContent()).isEqualTo("visible root");
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
    void acknowledgementsRemainBoundToTheirExactMessage() {
        ByaiGroupChatMessageAckMapper acknowledgements = mock(ByaiGroupChatMessageAckMapper.class);
        service = new GroupChatContextService(messageMapper, sessionService, resourceService, null, null,
            acknowledgements);
        ReflectionTestUtils.setField(service, "taskMapper", tasks);
        ByaiMessage first = message(10L, 1, "@张三 第一条", 10L);
        ByaiMessage second = message(20L, 1, "@张三 第二条", 20L);
        ByaiMessage third = message(30L, 1, "@张三 第三条", 30L);
        ByaiGroupChatMessageAck ack = new ByaiGroupChatMessageAck();
        ack.setSessionId(3L);
        ack.setMessageId(20L);
        ack.setUserId(100L);
        ack.setUserName("张三");
        ack.setAcknowledgedAt(new Date(40L));
        when(acknowledgements.selectByMessageIds(3L, List.of(10L, 20L, 30L))).thenReturn(List.of(ack));

        List<GroupChatContextResponse.Message> projected = service.toMessages(List.of(first, second, third));

        assertThat(projected.get(0).getAcknowledgements()).isEmpty();
        assertThat(projected.get(1).getAcknowledgements()).singleElement().satisfies(item -> {
            assertThat(item.getMessageId()).isEqualTo("20");
            assertThat(item.getUserId()).isEqualTo("100");
        });
        assertThat(projected.get(2).getAcknowledgements()).isEmpty();
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

    @Test
    void restoresPublishedCloudFilesWithoutFileIdsAndKeepsOrdinaryAttachments() {
        ByaiMessage source = message(20L, 2, "成果", 200L);
        source.setMetadata("{\"scene\":\"GROUP_CHAT\",\"kind\":\"TASK_RESULT\",\"files\":["
            + "{\"fileName\":\"REPORT.md\",\"filePath\":\"/results/REPORT.md\","
            + "\"cloudResourceId\":\"9007199254740993\"},null,{},\"invalid\"]}");
        source.setRelatedResources("{\"files\":[{\"fileId\":\"10\",\"fileName\":\"input.pdf\","
            + "\"fileUrl\":\"/commonFile/preview?filePath=/by/input.pdf\"}]}");
        var attachments = loadSingle(source).getAttachments();
        assertThat(attachments).hasSize(2);
        assertThat(attachments.get(0).getFileId()).isEqualTo("10");
        assertThat(attachments.get(0).getFileUrl())
            .isEqualTo("/commonFile/preview?filePath=/by/input.pdf");
        assertThat(attachments.get(1).getFileId()).isNull();
        assertThat(attachments.get(1).getFileName()).isEqualTo("REPORT.md");
        assertThat(attachments.get(1).getFilePath()).isEqualTo("/results/REPORT.md");
        assertThat(attachments.get(1).getCloudResourceId()).isEqualTo("9007199254740993");
    }

    @Test
    void restoresOldPublicationUsingGroupProjectCloud() {
        ProjectService projects = mock(ProjectService.class);
        ReflectionTestUtils.setField(service, "projectService", projects);
        Project project = new Project();
        project.setCloudResourceId(777L);
        when(projects.findById(5L)).thenReturn(project);
        ByaiMessage source = message(20L, 2, "旧成果", 200L);
        source.setMetadata("{\"scene\":\"GROUP_CHAT\",\"kind\":\"TASK_RESULT\",\"files\":["
            + "{\"fileName\":\"REPORT.md\",\"filePath\":\"/results/REPORT.md\"}]}");
        assertThat(loadSingle(source).getAttachments()).singleElement().satisfies(file -> {
            assertThat(file.getCloudResourceId()).isEqualTo("777");
            assertThat(file.getFilePath()).isEqualTo("/results/REPORT.md");
        });
        when(projects.findById(5L)).thenReturn(null);
        assertThat(loadSingle(source).getAttachments()).singleElement().satisfies(file -> {
            assertThat(file.getCloudResourceId()).isNull();
            assertThat(file.getFileName()).isEqualTo("REPORT.md");
        });
    }

    @Test
    void malformedMetadataAndNonPublicationFilesDoNotBreakOrdinaryAttachments() {
        ByaiMessage source = message(20L, 1, "正文", 200L);
        source.setRelatedResources("{\"files\":[{\"fileId\":\"10\",\"fileName\":\"input.pdf\"}]}");
        for (String metadata : Arrays.asList("invalid", null,
            "{\"scene\":\"GROUP_CHAT\",\"kind\":\"TASK_RESULT\",\"files\":{}}",
            "{\"scene\":\"GROUP_CHAT\",\"kind\":\"TASK_ACK\",\"files\":[{\"fileName\":\"private.md\",\"filePath\":\"/by/private.md\"}]}")) {
            source.setMetadata(metadata);
            assertThat(loadSingle(source).getAttachments()).singleElement()
                .satisfies(file -> assertThat(file.getFileId()).isEqualTo("10"));
        }
        source.setRelatedResources(null);
        assertThat(loadSingle(source).getAttachments()).isNull();
    }

    @Test
    void taskMessagesExposeActualOwnerAsStringWithOneBatchQuery() {
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(60L);
        task.setGroupSessionId(3L);
        task.setInitiatorUserId(9007199254740993L);
        when(tasks.selectBatchIds(anyCollection())).thenReturn(List.of(task));
        ByaiMessage result = message(20L, 2, "报告", 200L);
        result.setCreatorId(40L);
        result.setMetadata("{\"kind\":\"TASK_RESULT\",\"taskId\":60,\"publisherUserId\":100,\"initiatorUserId\":999}");
        ByaiMessage ack = message(19L, 2, "已接收", 100L);
        ack.setMetadata("{\"kind\":\"TASK_ACK\",\"taskId\":60}");
        ByaiSession group = new ByaiSession(); group.setSessionId(3L);
        when(sessionService.findById(3L)).thenReturn(group);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 60)).thenReturn(List.of(result, ack));
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3"); request.setBeforeMessageId("30");
        GroupChatContextResponse response = service.load(request);
        assertThat(response.getMessages()).allSatisfy(message ->
            assertThat(message.getInitiatorUserId()).isEqualTo("9007199254740993"));
        verify(tasks).selectBatchIds(List.of(60L));
    }

    @Test
    void missingInvalidOrCrossGroupTaskCannotSupplyAnOwner() {
        ByaiMessage source = message(20L, 2, "历史结果", 200L);
        source.setMetadata("{\"kind\":\"TASK_RESULT\",\"taskId\":60}");
        assertThat(loadSingle(source).getInitiatorUserId()).isNull();
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(60L); task.setGroupSessionId(99L); task.setInitiatorUserId(100L);
        when(tasks.selectBatchIds(anyCollection())).thenReturn(List.of(task));
        assertThat(loadSingle(source).getInitiatorUserId()).isNull();
        for (String metadata : List.of("invalid-json", "{\"kind\":\"TASK_RESULT\",\"taskId\":\"invalid\"}",
            "{\"kind\":\"TASK_RESULT\"}", "{\"taskId\":60}")) {
            source.setMetadata(metadata);
            assertThat(loadSingle(source).getInitiatorUserId()).isNull();
        }
        source.setMetadata("{\"kind\":\"TASK_RESULT\",\"taskId\":60}");
        source.setUsage(1);
        task.setGroupSessionId(3L);
        assertThat(loadSingle(source).getInitiatorUserId()).isNull();
    }

    private GroupChatContextResponse.Message loadSingle(ByaiMessage source) {
        ByaiSession group = new ByaiSession();
        group.setSessionId(3L);
        group.setProjectId(5L);
        when(sessionService.findById(3L)).thenReturn(group);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 60))
            .thenReturn(Collections.singletonList(source));
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3");
        request.setBeforeMessageId("30");
        return service.load(request).getMessages().get(0);
    }

    @Test
    void timelineIncludesSystemEventsWhileAgentWindowAndRepliesExcludeThem() {
        when(sessionService.findById(3L)).thenReturn(new ByaiSession());
        ByaiMessage event = message(20L, 5, "张三 邀请 李四 加入工作组", 200L);
        event.setMetadata("{\"systemEvent\":{\"eventType\":\"MEMBER_INVITED\","
            + "\"operatorId\":\"9223372036854775806\",\"memberId\":\"101\",\"memberName\":\"李四\"}}");
        ByaiMessage reply = message(25L, 1, "收到", 250L);
        reply.setMessageRef(20L);
        when(messageMapper.selectByMessageId(20L)).thenReturn(event);
        when(messageMapper.selectTimelineBeforeMessageId(3L, 30L, 2)).thenReturn(List.of(reply, event));
        when(messageMapper.countTimelineBeforeMessageId(3L, 30L)).thenReturn(3L);
        when(messageMapper.selectVisibleBeforeMessageId(3L, 30L, 2)).thenReturn(List.of(reply));
        when(messageMapper.countVisibleBeforeMessageId(3L, 30L)).thenReturn(1L);
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("3");
        request.setBeforeMessageId("30");
        request.setMaxMessages(2);

        GroupChatContextResponse timeline = service.loadTimeline(request);
        assertThat(timeline.getMessages()).extracting(GroupChatContextResponse.Message::getUsage).containsExactly(5, 1);
        GroupChatContextResponse.Message projected = timeline.getMessages().get(0);
        assertThat(projected.getRole()).isEqualTo("event");
        assertThat(projected.getKind()).isEqualTo("SYSTEM_EVENT");
        assertThat(projected.getSpeaker().getType()).isEqualTo("system");
        assertThat(projected.getSpeaker().getAgentId()).isNull();
        assertThat(projected.getSystemEvent().getOperatorId()).isEqualTo("9223372036854775806");
        assertThat(timeline.getMessages().get(1).getReplyTo().getUsage()).isEqualTo(5);
        assertThat(timeline.getTruncation().getOmittedMessageCount()).isEqualTo(1);
        GroupChatContextResponse agent = service.load(request);
        assertThat(agent.getMessages()).singleElement().satisfies(message -> assertThat(message.getReplyTo()).isNull());
        assertThat(agent.getTruncation().getTruncated()).isFalse();
        assertThat(agent.getSnapshot().getLastIncludedMessageId()).isEqualTo("25");
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
