package com.iwhalecloud.byai.state.domain.message.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;

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
