package com.iwhalecloud.byai.state.domain.chat.model;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;

class MessageContextTest {

    @Test
    void recordInferLog_mergesSameOrderIdWithoutDroppingFirstFragment() {
        MessageContext context = new MessageContext();

        context.recordInferLog(answerDelta("There", "first-order"));
        context.recordInferLog(answerDelta(" MODEL_API_KEY environment", "second-order"));
        context.recordInferLog(answerDelta(" variable. This", "second-order"));

        assertThat(context.getReasonMessageList()).hasSize(2);
        assertThat(contentAt(context.getReasonMessageList(), 0)).isEqualTo("There");
        assertThat(contentAt(context.getReasonMessageList(), 1)).isEqualTo(" MODEL_API_KEY environment variable. This");
        assertThat(contentAt(context.getStreamReasonMessageList(), 1))
            .isEqualTo(" MODEL_API_KEY environment variable. This");
    }

    @Test
    void hasPersistableContent_detectsEmptyAndNonEmptyResponses() {
        MessageContext emptyContext = new MessageContext();
        assertThat(emptyContext.hasPersistableContent()).isFalse();

        MessageContext titleOnlyContext = new MessageContext();
        titleOnlyContext.recordAnswerStruct(answerDelta("ByClaw coder 智能体已就绪", "ready-order", "3003"));
        assertThat(titleOnlyContext.hasPersistableContent()).isFalse();

        MessageContext answerContext = new MessageContext();
        answerContext.recordAnswerText(answerDelta("visible answer", "answer-order"));
        answerContext.recordAnswerStruct(answerDelta("visible answer", "answer-order"));
        assertThat(answerContext.hasPersistableContent()).isTrue();

        MessageContext inferContext = new MessageContext();
        inferContext.recordInferLog(answerDelta("visible thought", "thought-order"));
        assertThat(inferContext.hasPersistableContent()).isTrue();
    }

    @Test
    void markFirstResponseTimeIfAbsent_keepsEarliestResponseTime() {
        MessageContext context = new MessageContext();
        Date firstResponseTime = new Date(1000L);
        Date laterResponseTime = new Date(2000L);

        context.markFirstResponseTimeIfAbsent(firstResponseTime);
        context.markFirstResponseTimeIfAbsent(laterResponseTime);

        assertThat(context.getFirstResponseTime()).isEqualTo(firstResponseTime);
    }

    private static String answerDelta(String content, String orderId) {
        return answerDelta(content, orderId, "1002");
    }

    private static String answerDelta(String content, String orderId, String contentType) {
        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setContentType(contentType);
        answerDelta.setOrderId(orderId);

        ChoiceDto choice = new ChoiceDto();
        choice.setIndex("0");
        choice.setFinish_reason("");
        choice.setDelta(new DeltaDto(content));
        answerDelta.setChoices(List.of(choice));

        return JSON.toJSONString(answerDelta);
    }

    private static String contentAt(List<AnswerDelta> answerDeltas, int index) {
        return answerDeltas.get(index).getChoices().get(0).getDelta().getContent();
    }
}
