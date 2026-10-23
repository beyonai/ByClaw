package com.iwhalecloud.byai.state.domain.message.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.PythonSseService;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

class MemoryMessageServiceTest {

    private final MemoryMessageService memoryMessageService = new MemoryMessageService();
    private ByaiMessageHotService byaiMessageHotService;

    @BeforeEach
    void setUp() {
        ByaiSystemConfigService byaiSystemConfigService = mock(ByaiSystemConfigService.class);
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID))
            .thenReturn("1");
        ReflectionTestUtils.setField(memoryMessageService, "byaiSystemConfigService", byaiSystemConfigService);
        byaiMessageHotService = mock(ByaiMessageHotService.class);
        ReflectionTestUtils.setField(memoryMessageService, "byaiMessageHotService", byaiMessageHotService);
    }

    @Test
    void executionLocationUsesTheSameDescendingPositionAsHistoryPages() {
        var query = new com.iwhalecloud.byai.state.common.dto.MessageQo();
        query.setSessionId(3L);
        query.setMessageId(21L);
        var message = new ByaiMessageHotDto();
        message.setSessionId(3L);
        when(byaiMessageHotService.findById(21L)).thenReturn(message);
        when(byaiMessageHotService.countBySessionId(3L)).thenReturn(40L);
        var outline = new com.iwhalecloud.byai.common.message.entity.ConversationOutlineItem();
        outline.setMessageId(21L);
        outline.setPosition(22L);
        outline.setTotalCount(40L);
        when(byaiMessageHotService.selectConversationOutline(3L)).thenReturn(java.util.List.of(outline));
        assertThat(memoryMessageService.getMessageCountAndPosition(query))
            .containsEntry("position", 22L).containsEntry("totalCount", 40L);
    }

    @Test
    void voiceMetadataSurvivesUserPersistenceWithoutMarkingAssistantRepliesAsVoice() {
        AssistantChatDto chat = new AssistantChatDto();
        chat.setMetadata("{\"mode\":\"smart\"}");
        chat.setExtParams(java.util.Map.of("voice", java.util.Map.of("fileId", "55", "durationMs", 1200),
            "messageType", "VOICE"));
        MessageContext context = new MessageContext();
        context.setMessageId(21L);
        context.setTaskId(22L);
        context.getAnswerText().append("[语音消息]");
        var user = memoryMessageService.generateMessage(3L, ChatUseageEnum.USER_INPUT.getCode(), context, chat);
        assertThat(user.getMetadata()).contains("VOICE", "55", "smart");
        var answer = memoryMessageService.generateMessage(3L, ChatUseageEnum.SYSTEM_RESPONSE.getCode(), context, chat);
        assertThat(answer.getMetadata()).doesNotContain("VOICE", "voice");
    }

    @Test
    void explicitFinalBodyIsPersistedAndRegenerationClearsItWhenAbsent() {
        MessageContext context = new MessageContext();
        context.setMessageId(21L);
        context.setTaskId(22L);
        context.getAnswerText().append("intermediate");
        context.setExplicitFinalAnswer("final");
        ByaiMessageHotDto message = memoryMessageService.generateMessage(3L,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), context, new AssistantChatDto());
        assertThat(message.getMessageContent()).isEqualTo("final");
        assertThat(message.getFinalContent()).isEqualTo("final");

        MessageContext regenerated = new MessageContext();
        new PythonSseService().accumulateEvent(
            "{\"event\":\"answerDelta\",\"data\":{\"contentType\":\"1001\",\"choices\":[{\"delta\":{\"content\":\"new answer\"}}]}}",
            regenerated);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setTaskOperateType(TaskOperateTypeEnum.UPDATE);
        memoryMessageService.updateTaskMessage(new ChatProcessContext(null, dto), message, regenerated);
        assertThat(message.getMessageContent()).isEqualTo("new answer");
        assertThat(message.getFinalContent()).isNull();
        assertThat(message.isReplaceFinalContent()).isTrue();
        assertThat(message.getMessageStruct()).contains("new answer");
    }

    @Test
    void generateMessage_usesFirstResponseTimeAsCreateTimeWhenPresent() {
        Date firstResponseTime = new Date(1000L);
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.setTaskId(22L);
        messageContext.getAnswerText().append("answer");
        messageContext.markFirstResponseTimeIfAbsent(firstResponseTime);

        ByaiMessageHotDtoDto message = memoryMessageService.generateMessage(3L,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext, new AssistantChatDto());

        assertThat(message.getCreateTime()).isEqualTo(firstResponseTime);
    }

    @Test
    void generateMessage_fallsBackToCurrentTimeWhenFirstResponseTimeIsAbsent() {
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.setTaskId(22L);
        messageContext.getAnswerText().append("answer");

        ByaiMessageHotDtoDto message = memoryMessageService.generateMessage(3L,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext, new AssistantChatDto());

        assertThat(message.getCreateTime()).isNotNull();
    }

    @Test
    void generateMessage_preservesCompletedState() {
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.setTaskId(22L);
        messageContext.setComplete(true);

        ByaiMessageHotDtoDto message = memoryMessageService.generateMessage(3L,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext, new AssistantChatDto());

        assertThat(message.isComplete()).isTrue();
    }

    @Test
    void generateMessage_treatsMissingCompletedStateAsIncomplete() {
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.setTaskId(22L);
        messageContext.setComplete(null);

        ByaiMessageHotDtoDto message = memoryMessageService.generateMessage(3L,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext, new AssistantChatDto());

        assertThat(message.isComplete()).isFalse();
    }

    @Test
    void saveOrUpdate_usesIdempotentMessagePersistence() {
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.setTaskId(22L);
        messageContext.getAnswerText().append("answer");

        ByaiMessageHotDtoDto message = memoryMessageService.saveOrUpdate(3L,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext, new AssistantChatDto());

        assertThat(message.getMessageId()).isEqualTo(21L);
        verify(byaiMessageHotService).updateSelective(message);
    }
}
