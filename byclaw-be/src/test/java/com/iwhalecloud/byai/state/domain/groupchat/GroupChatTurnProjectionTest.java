package com.iwhalecloud.byai.state.domain.groupchat;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTurnCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatTurnProjectionTest {
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final GroupChatTurnCoordinator coordinator = mock(GroupChatTurnCoordinator.class);
    private final GroupChatTaskService tasks = mock(GroupChatTaskService.class);
    private final GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
    private final GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
    private final GroupChatDispositionReader reader = mock(GroupChatDispositionReader.class);
    private final UserService users = mock(UserService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messages, publisher,
        sequence, mock(ByaiGroupChatExecutionMapper.class), mock(GroupChatExecutionCoordinator.class),
        mock(SsResourceService.class), users, reader, tasks, mock(GroupChatCandidateSessionService.class), parser,
        mock(GroupChatMentionService.class), mock(ChatRuntimeStateService.class));
    private ByaiGroupChatTurn turn;
    private ChatProcessContext context;
    private ByaiMessage answer;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(handler, "turnMapper", turns);
        ReflectionTestUtils.setField(handler, "turnCoordinator", coordinator);
        turn = new ByaiGroupChatTurn();
        turn.setExecutionId(10L); turn.setCandidateSessionId(60L); turn.setGatewaySessionId("60");
        turn.setGroupSessionId(1L); turn.setSourceMessageId(2L); turn.setRootMessageId(2L);
        turn.setTargetAgentId(8L); turn.setInitiatorUserId(7L); turn.setTraceId("current-trace");
        turn.setStatus("RUNNING"); turn.setPhase("NORMAL"); turn.setDisposition("UNKNOWN");
        when(turns.selectByTrace("current-trace")).thenReturn(turn);
        when(turns.selectById(10L)).thenReturn(turn);
        Users user = new Users(); user.setUserCode("user-7");
        when(users.findById(7L)).thenReturn(user);
        context = new ChatProcessContext(null, null); context.sessionId = 60L; context.traceId = "current-trace";
        context.modelAnswerMessageId = 30L;
        answer = new ByaiMessage(); answer.setMessageId(30L); answer.setSessionId(60L);
        answer.setUsage(2); answer.setIsComplete(true); answer.setMessageContent("reply");
        when(messages.selectByMessageId(30L)).thenReturn(answer);
    }

    @Test
    void invalidAssessmentFailsClosedWithoutBusinessOrPublicProjection() {
        turn.setPhase("ASSESSMENT");
        handler.afterPersisted(context);
        verify(turns).markFailed(eq(10L), eq("INVALID_ASSESSMENT"), any(), any());
        verifyNoInteractions(coordinator, parser, publisher, tasks);
        verify(messages, never()).insert(any());
    }

    @Test
    void validAssessmentOnlyResetsForBusinessExecution() {
        turn.setPhase("ASSESSMENT");
        GroupChatDisposition disposition = new GroupChatDisposition(); disposition.setKind("TASK");
        when(reader.read("user-7", 60L, 10L)).thenReturn(disposition);
        handler.afterPersisted(context);
        verify(coordinator).completeAssessment(turn, "TASK");
        verifyNoInteractions(parser, publisher, tasks);
        verify(messages, never()).insert(any());
    }

    @Test
    void staleAssessmentCallbackCannotCompleteResetTurn() {
        turn.setPhase("CHAT_CONTINUATION"); turn.setTraceId("next-trace");
        handler.afterPersisted(context);
        verifyNoInteractions(reader, coordinator, parser, publisher, tasks);
    }

    @Test
    void continuedChatProjectsCurrentTurnAndCompletesIt() {
        turn.setPhase("CHAT_CONTINUATION"); turn.setDisposition("CHAT");
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        when(sequence.nextVal()).thenReturn(90L);
        handler.afterPersisted(context);
        verify(messages).insert(any());
        verify(turns).markSucceeded(eq(10L), eq(90L), any());
        verify(tasks, never()).promote(any(), any(), any());
    }

    @Test
    void taskTurnEndsWithoutPublishingItsPrivateAnswer() {
        turn.setDisposition("TASK");
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        handler.afterPersisted(context);
        verify(tasks).updateTurnStatus(60L, "WAITING_USER");
        verify(turns).markSucceeded(eq(10L), eq(30L), any());
        verify(messages, never()).insert(any());
        verifyNoInteractions(publisher);
    }
}
