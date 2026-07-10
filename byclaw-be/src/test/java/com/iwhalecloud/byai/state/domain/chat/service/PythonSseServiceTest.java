package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Date;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;

class PythonSseServiceTest {

    private final PythonSseService pythonSseService = new PythonSseService();

    @Test
    void getContentFromPythonStreamV3_marksFirstResponseTimeOnAnswerDelta() {
        MessageContext messageContext = new MessageContext();
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());

        pythonSseService.getContentFromPythonStreamV3(
            streamLine(SseResponseEventEnum.answerDelta, answerDelta("answer")),
            null,
            messageContext,
            Set.of(),
            ctx);

        assertThat(messageContext.getFirstResponseTime()).isNotNull();
    }

    @Test
    void getContentFromPythonStreamV3_marksReasoningDeltaAsVisibleResponseWithoutOverwritingExistingTime() {
        MessageContext messageContext = new MessageContext();
        Date existingTime = new Date(1000L);
        messageContext.markFirstResponseTimeIfAbsent(existingTime);
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());

        pythonSseService.getContentFromPythonStreamV3(
            streamLine(SseResponseEventEnum.reasoningLogDelta, answerDelta("thought")),
            null,
            messageContext,
            Set.of(),
            ctx);

        assertThat(messageContext.getFirstResponseTime()).isEqualTo(existingTime);
    }

    private static String streamLine(String event, String data) {
        JSONObject line = new JSONObject();
        line.put("event", event);
        line.put("data", data);
        return line.toJSONString();
    }

    private static String answerDelta(String content) {
        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setContentType("1002");

        ChoiceDto choice = new ChoiceDto();
        choice.setIndex("0");
        choice.setFinish_reason("");
        choice.setDelta(new DeltaDto(content));
        answerDelta.setChoices(List.of(choice));

        return JSON.toJSONString(answerDelta);
    }
}
