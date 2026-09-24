package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.Connection;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatActiveTaskException;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTurnCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatTurnCoordinatorTest {
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatExecutionMapper anchors = mock(ByaiGroupChatExecutionMapper.class);
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatCandidateSessionService candidates = mock(GroupChatCandidateSessionService.class);
    private GroupChatTurnCoordinator coordinator;
    private final Map<String, ByaiGroupChatExecution> anchorRows = new HashMap<>();
    private final Map<String, ByaiGroupChatTurn> turnRows = new HashMap<>();

    @BeforeEach
    void setup() {
        SequenceService sequence = mock(SequenceService.class);
        AtomicLong ids = new AtomicLong(1000);
        when(sequence.nextVal()).thenAnswer(call -> ids.incrementAndGet());
        when(candidates.createEmpty(anyLong(), anyLong(), anyLong(), anyLong())).thenAnswer(call -> ids.incrementAndGet());
        when(anchors.insert(any(ByaiGroupChatExecution.class))).thenAnswer(call -> {
            ByaiGroupChatExecution row = call.getArgument(0);
            anchorRows.put(row.getRootMessageId() + ":" + row.getTargetAgentId() + ":" + row.getInitiatorUserId(), row);
            return 1;
        });
        when(turns.selectAnchor(anyLong(), anyLong(), anyLong())).thenAnswer(call ->
            anchorRows.get(call.getArgument(0) + ":" + call.getArgument(1) + ":" + call.getArgument(2)));
        when(turns.insert(any(ByaiGroupChatTurn.class))).thenAnswer(call -> {
            ByaiGroupChatTurn row = call.getArgument(0);
            turnRows.put(row.getTriggerMessageId() + ":" + row.getTargetAgentId(), row); return 1;
        });
        when(turns.selectByTriggerAndAgent(anyLong(), anyLong())).thenAnswer(call -> turnRows.get(call.getArgument(0) + ":" + call.getArgument(1)));
        when(messages.selectByMessageId(anyLong())).thenAnswer(call -> {
            ByaiMessage message = new ByaiMessage(); message.setMessageId(call.getArgument(0));
            message.setSessionId(10L); message.setMessageContent("Analyze company news"); return message;
        });
        SessionMemberService members = mock(SessionMemberService.class);
        when(members.findSessionMember(anyLong(), anyString(), anyLong())).thenReturn(new ByaiSessionMember());
        UserService users = mock(UserService.class); Users user = new Users(); user.setUserName("Owner");
        when(users.findById(anyLong())).thenReturn(user);
        SsResourceService resources = mock(SsResourceService.class);
        when(resources.findById(anyLong())).thenAnswer(call -> { SsResource agent = new SsResource(); agent.setResourceName("Agent " + call.getArgument(0)); return agent; });
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        GroupChatContextService contextService = new GroupChatContextService(messages, mock(SessionService.class),
            resources);
        coordinator = new GroupChatTurnCoordinator(turns, anchors, tasks, messages, candidates, sequence, members,
            mock(SessionService.class), users, resources, mock(ChatRuntimeStateService.class),
            mock(GroupChatGatewayExecutor.class), contextService, transactions);
        ReflectionTestUtils.setField(coordinator, "workers", mock(ExecutorService.class));
    }

    @Test
    void enqueueSchedulesOnlyAfterSuccessfulDatabaseCommit() throws Exception {
        Connection connection = mock(Connection.class);
        DataSource dataSource = mock(DataSource.class);
        when(connection.getAutoCommit()).thenReturn(true);
        when(dataSource.getConnection()).thenReturn(connection);
        ReflectionTestUtils.setField(coordinator, "transaction", new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
        ExecutorService workers = mock(ExecutorService.class);
        ReflectionTestUtils.setField(coordinator, "workers", workers);
        coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        var order = inOrder(connection, workers);
        order.verify(connection).commit();
        order.verify(workers).execute(any(Runnable.class));
    }

    @Test
    void rolledBackEnqueueNeverSchedulesAgent() throws Exception {
        Connection connection = mock(Connection.class);
        DataSource dataSource = mock(DataSource.class);
        when(connection.getAutoCommit()).thenReturn(true);
        when(dataSource.getConnection()).thenReturn(connection);
        ReflectionTestUtils.setField(coordinator, "transaction", new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
        ExecutorService workers = mock(ExecutorService.class);
        ReflectionTestUtils.setField(coordinator, "workers", workers);
        when(turns.insert(any(ByaiGroupChatTurn.class))).thenThrow(new IllegalStateException("database failure"));
        assertThrows(IllegalStateException.class, () -> coordinator.enqueueUser(10L, 20L, null, 1L, 2L));
        verify(connection).rollback();
        verifyNoInteractions(workers);
    }

    @AfterEach
    void cleanup() { coordinator.shutdown(); }

    @Test
    void agentReturnReusesItsOwnSessionAndCarriesImmediateSender() {
        ByaiGroupChatTurn a = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        ByaiGroupChatTurn b = coordinator.enqueueAgent(a, 3L, 21L, 21L, "Collect financing news", null);
        ByaiGroupChatTurn back = coordinator.enqueueAgent(b, 2L, 22L, 22L, "Here are the sources", null);
        assertEquals(a.getCandidateSessionId(), back.getCandidateSessionId());
        assertNotEquals(a.getCandidateSessionId(), b.getCandidateSessionId());
        JSONObject input = JSON.parseObject(back.getInputContent());
        assertEquals("Here are the sources", input.getString("本次消息"));
        assertEquals(3L, input.getLong("本次发送者ID"));
        assertFalse(input.containsKey("本次引用消息"));
        assertEquals("Analyze company news", input.getString("原始用户需求"));
        assertEquals(2, back.getHopCount());
        assertNotEquals(a.getCandidateSessionId(), coordinator.enqueueUser(10L, 30L, null, 1L, 2L).getCandidateSessionId());
    }

    @Test
    void duplicateTriggerDoesNotCreateAnotherTurnAndSixthHopIsAllowed() {
        ByaiGroupChatTurn a = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        a.setHopCount(5);
        ByaiGroupChatTurn sixth = coordinator.enqueueAgent(a, 3L, 21L, 21L, "Proceed", null);
        assertEquals(6, sixth.getHopCount());
        assertSame(sixth, coordinator.enqueueAgent(a, 3L, 21L, 21L, "Proceed", null));
        assertNull(coordinator.enqueueAgent(sixth, 2L, 22L, 22L, "Return", null));
        assertEquals(2, turnRows.size());
    }

    @Test
    void activeTaskBlocksAgentContinuationEvenWhileWaitingForUser() {
        ByaiGroupChatTurn a = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        ByaiGroupChatTask task = new ByaiGroupChatTask(); task.setStatus("ACTIVE"); task.setTurnStatus("WAITING_USER");
        when(tasks.selectById(a.getCandidateSessionId())).thenReturn(task);
        ByaiGroupChatTurn other = coordinator.enqueueAgent(a, 3L, 21L, 21L, "Collect", null);
        ByaiGroupChatTurn blocked = coordinator.enqueueAgent(other, 2L, 22L, 22L, "Return", null);
        assertEquals("BLOCKED", blocked.getStatus()); assertEquals("ACTIVE_TASK", blocked.getErrorCode());
        assertEquals(a.getCandidateSessionId(), blocked.getCandidateSessionId());
    }

    @Test
    void quotedUserInputResetsBudgetWithoutReplacingBackground() {
        ByaiGroupChatTurn a = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        a.setHopCount(6); when(turns.selectByPublicMessage(21L)).thenReturn(a);
        ByaiGroupChatTurn next = coordinator.enqueueUser(10L, 22L, 21L, 1L, 2L);
        assertEquals(0, next.getHopCount()); assertEquals(20L, next.getRootMessageId());
        assertEquals(a.getCandidateSessionId(), next.getCandidateSessionId());
        ByaiGroupChatTurn otherUser = coordinator.enqueueUser(10L, 23L, 21L, 9L, 2L);
        assertEquals(20L, otherUser.getRootMessageId());
        assertEquals(9L, otherUser.getInitiatorUserId());
        assertNotEquals(a.getCandidateSessionId(), otherUser.getCandidateSessionId());
        assertEquals(otherUser.getCandidateSessionId(), coordinator.enqueueUser(10L, 24L, 21L, 9L, 2L)
            .getCandidateSessionId());
    }

    @Test
    void activeTaskRejectsOnlyItsOwnerEvenWhenAnotherUserQuotesTheSameReply() {
        ByaiGroupChatTurn first = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        when(turns.selectByPublicMessage(21L)).thenReturn(first);
        ByaiGroupChatTask firstTask = new ByaiGroupChatTask();
        firstTask.setTaskSessionId(first.getCandidateSessionId());
        firstTask.setStatus("ACTIVE");
        when(tasks.selectById(first.getCandidateSessionId())).thenReturn(firstTask);

        GroupChatActiveTaskException rejection = assertThrows(GroupChatActiveTaskException.class,
            () -> coordinator.enqueueUser(10L, 22L, 21L, 1L, 2L));
        assertEquals(first.getCandidateSessionId(), rejection.getTaskId());
        assertEquals(2L, rejection.getAgentId());

        ByaiGroupChatTurn second = coordinator.enqueueUser(10L, 23L, 21L, 9L, 2L);
        assertEquals(first.getRootMessageId(), second.getRootMessageId());
        assertEquals(9L, second.getInitiatorUserId());
        assertNotEquals(first.getCandidateSessionId(), second.getCandidateSessionId());
        verify(candidates).createEmpty(10L, 23L, 9L, 2L);
        verify(tasks).selectById(second.getCandidateSessionId());

        ByaiGroupChatTask secondTask = new ByaiGroupChatTask();
        secondTask.setTaskSessionId(second.getCandidateSessionId());
        secondTask.setStatus("ACTIVE");
        when(tasks.selectById(second.getCandidateSessionId())).thenReturn(secondTask);
        GroupChatActiveTaskException secondRejection = assertThrows(GroupChatActiveTaskException.class,
            () -> coordinator.enqueueUser(10L, 24L, 21L, 9L, 2L));
        assertEquals(second.getCandidateSessionId(), secondRejection.getTaskId());

        when(turns.selectByPublicMessage(25L)).thenReturn(second);
        assertThrows(GroupChatActiveTaskException.class,
            () -> coordinator.enqueueUser(10L, 26L, 25L, 1L, 2L));
        ByaiGroupChatTurn anotherAgent = coordinator.enqueueUser(10L, 27L, 25L, 1L, 3L);
        assertEquals(first.getRootMessageId(), anotherAgent.getRootMessageId());
        assertNotEquals(first.getCandidateSessionId(), anotherAgent.getCandidateSessionId());
        assertEquals(1L, anotherAgent.getInitiatorUserId());
    }

    @Test
    void legacyPublicAnchorProvidesRootWithoutTransferringItsOwner() {
        ByaiGroupChatTurn first = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        ByaiGroupChatExecution legacyAnchor = anchorRows.get("20:2:1");
        when(anchors.selectByPublicMessage(21L)).thenReturn(legacyAnchor);

        ByaiGroupChatTurn quoted = coordinator.enqueueUser(10L, 22L, 21L, 9L, 2L);

        assertEquals(20L, quoted.getRootMessageId());
        assertEquals(9L, quoted.getInitiatorUserId());
        assertNotEquals(first.getCandidateSessionId(), quoted.getCandidateSessionId());
        verify(candidates).createEmpty(10L, 22L, 9L, 2L);
    }

    @Test
    void publishedTaskReplyReusesReferencedSessionWithoutClassificationOrNewAnchor() {
        ByaiGroupChatTurn original = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        when(turns.selectByPublicMessage(21L)).thenReturn(original);
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setStatus("PUBLISHED"); task.setPublishMessageId(21L);
        when(tasks.selectById(original.getCandidateSessionId())).thenReturn(task);
        ByaiGroupChatTurn reply = coordinator.enqueueUser(10L, 22L, 21L, 1L, 2L);
        assertEquals("CHAT_CONTINUATION", reply.getPhase());
        assertEquals("CHAT", reply.getDisposition());
        assertEquals(original.getCandidateSessionId(), reply.getCandidateSessionId());
        assertEquals(String.valueOf(original.getCandidateSessionId()), reply.getGatewaySessionId());
        assertEquals("Analyze company news", JSON.parseObject(reply.getInputContent()).getString("已完成任务的公开成果"));
        verify(candidates, times(1)).createEmpty(anyLong(), anyLong(), anyLong(), anyLong());
        verify(anchors, times(1)).insert(any(ByaiGroupChatExecution.class));
        // 非引用 @ 仍从新的协作链开始，允许用户重新发起产物修改任务。
        ByaiGroupChatTurn fresh = coordinator.enqueueUser(10L, 23L, null, 1L, 2L);
        assertEquals("NORMAL", fresh.getPhase());
        assertNotEquals(original.getCandidateSessionId(), fresh.getCandidateSessionId());
    }

    @Test
    void inputRenderingRetainsBackgroundAndCurrentMentionResources() {
        ByaiMessage root = new ByaiMessage();
        root.setMessageContent("{{DIG_EMPLOYEE_2}} Analyze news");
        root.setMetadata("{\"resourceList\":[{\"id\":\"DIG_EMPLOYEE_2\",\"resourceType\":\"DIG_EMPLOYEE\",\"resourceId\":\"2\"}]}");
        when(messages.selectByMessageId(20L)).thenReturn(root);
        ByaiGroupChatTurn a = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        Object currentResources = JSON.parseArray("[{\"id\":\"DIG_EMPLOYEE_3\",\"resourceType\":\"DIG_EMPLOYEE\",\"resourceId\":\"3\"}]");
        ByaiGroupChatTurn b = coordinator.enqueueAgent(a, 3L, 21L, 21L,
            "{{DIG_EMPLOYEE_3}} Collect sources", currentResources);
        assertEquals(2, JSON.parseObject(b.getInputMetadata()).getJSONArray("resourceList").size());
        assertEquals("3", JSON.parseObject(b.getInputMetadata()).getJSONArray("resourceList")
            .getJSONObject(1).getString("resourceId"));
    }

    @Test
    void quotedMessageIncludesItsIdentityContentAndAttachmentsInTurnContext() {
        ByaiMessage quoted = new ByaiMessage();
        quoted.setMessageId(21L);
        quoted.setSessionId(10L);
        quoted.setUsage(1);
        quoted.setCreatorName("Reporter");
        quoted.setMessageContent("Please review the report");
        quoted.setRelatedResources("{\"files\":[{\"fileId\":\"501\",\"fileName\":\"report.pdf\",\"fileUrl\":\"/files/report.pdf\"}]}");
        when(messages.selectByMessageId(21L)).thenReturn(quoted);
        when(messages.selectVisibleGroupMessage(10L, 21L)).thenReturn(quoted);
        ByaiGroupChatTurn original = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        when(turns.selectByPublicMessage(21L)).thenReturn(original);

        ByaiGroupChatTurn reply = coordinator.enqueueUser(10L, 22L, 21L, 1L, 2L);
        JSONObject reference = JSON.parseObject(reply.getInputContent()).getJSONObject("本次引用消息");
        assertEquals("21", reference.getString("messageId"));
        assertEquals("Please review the report", reference.getString("content"));
        assertEquals("Reporter", reference.getJSONObject("speaker").getString("displayName"));
        assertEquals("report.pdf", reference.getJSONArray("attachments").getJSONObject(0).getString("fileName"));
        assertEquals("/files/report.pdf", reference.getJSONArray("attachments").getJSONObject(0).getString("fileUrl"));
    }

    @Test
    void recalledQuotedMessageDoesNotExposeItsBodyOrFiles() {
        ByaiMessage quoted = new ByaiMessage();
        quoted.setMessageId(21L);
        quoted.setSessionId(10L);
        quoted.setUsage(1);
        quoted.setMessageContent("private quoted text");
        quoted.setRelatedResources("{\"files\":[{\"fileId\":\"501\",\"fileName\":\"secret.pdf\"}]}");
        quoted.setRecalledAt(new java.util.Date());
        when(messages.selectByMessageId(21L)).thenReturn(quoted);
        when(messages.selectVisibleGroupMessage(10L, 21L)).thenReturn(quoted);
        ByaiGroupChatTurn original = coordinator.enqueueUser(10L, 20L, null, 1L, 2L);
        when(turns.selectByPublicMessage(21L)).thenReturn(original);

        ByaiGroupChatTurn reply = coordinator.enqueueUser(10L, 22L, 21L, 1L, 2L);
        String context = reply.getInputContent();
        assertTrue(JSON.parseObject(context).getJSONObject("本次引用消息").getBooleanValue("recalled"));
        assertFalse(context.contains("private quoted text"));
        assertFalse(context.contains("secret.pdf"));
    }

}
