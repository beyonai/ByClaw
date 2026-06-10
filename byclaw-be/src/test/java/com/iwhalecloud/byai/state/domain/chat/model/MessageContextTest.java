package com.iwhalecloud.byai.state.domain.chat.model;

import static org.assertj.core.api.Assertions.assertThat;

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

    private static String answerDelta(String content, String orderId) {
        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setContentType("1002");
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
