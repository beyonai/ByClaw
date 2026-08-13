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
    void recordStruct_assignsGlobalSequenceAcrossThinkAndAnswerChannels() {
        MessageContext context = new MessageContext();

        context.recordInferLog(answerDelta("123", "A"));
        context.recordAnswerStruct(answerDelta("xxx", "B", "3009"));
        context.recordInferLog(answerDelta("456", "A"));

        assertThat(context.getReasonMessageList()).hasSize(2);
        assertThat(context.getAnswerMessageList()).hasSize(1);
        assertThat(context.getReasonMessageList().get(0).getSeq()).isEqualTo(1L);
        assertThat(context.getAnswerMessageList().get(0).getSeq()).isEqualTo(2L);
        assertThat(context.getReasonMessageList().get(1).getSeq()).isEqualTo(3L);
        assertThat(contentAt(context.getReasonMessageList(), 0)).isEqualTo("123");
        assertThat(contentAt(context.getReasonMessageList(), 1)).isEqualTo("456");
    }

    @Test
    void recordStruct_mergesOnlyGloballyAdjacentMatchingSegments() {
        MessageContext context = new MessageContext();

        String first = context.recordInferLog(answerDelta("12", "A"));
        String second = context.recordInferLog(answerDelta("34", "A"));

        assertThat(context.getReasonMessageList()).hasSize(1);
        assertThat(context.getReasonMessageList().get(0).getSeq()).isEqualTo(1L);
        assertThat(contentAt(context.getReasonMessageList(), 0)).isEqualTo("1234");
        assertThat(JSON.parseObject(first).getLong("seq")).isEqualTo(1L);
        assertThat(JSON.parseObject(first).getString("messageRenderVersion")).isEqualTo("v2");
        assertThat(JSON.parseObject(second).getLong("seq")).isEqualTo(1L);
    }

    @Test
    void recordAnswerStruct_updatesExistingToolCallAcrossInterveningAnswerSegment() {
        MessageContext context = new MessageContext();

        context.recordAnswerStruct(answerDelta("{\"title\":\"Bash\",\"input\":\"uname -m\"}", "tool-A", "3015"));
        context.recordAnswerStruct(answerDelta("between", "text-B", "3009"));
        String completed = context.recordAnswerStruct(
            answerDelta("{\"output\":\"arm64\",\"status\":\"_DONE_\"}", "tool-A", "3015"));

        assertThat(context.getAnswerMessageList()).hasSize(2);
        assertThat(context.getAnswerMessageList().get(0).getSeq()).isEqualTo(1L);
        assertThat(context.getAnswerMessageList().get(1).getSeq()).isEqualTo(2L);
        assertThat(JSON.parseObject(contentAt(context.getAnswerMessageList(), 0))).containsEntry("title", "Bash")
            .containsEntry("input", "uname -m")
            .containsEntry("output", "arm64")
            .containsEntry("status", "_DONE_");
        assertThat(JSON.parseObject(completed).getLong("seq")).isEqualTo(1L);
    }

    @Test
    void recordStruct_keepsSameOrderToolCallsSeparateAcrossChannels() {
        MessageContext context = new MessageContext();

        context.recordInferLog(answerDelta("{\"title\":\"think tool\"}", "tool-A", "3015"));
        context.recordAnswerStruct(answerDelta("{\"output\":\"answer tool\"}", "tool-A", "3015"));

        assertThat(context.getReasonMessageList()).hasSize(1);
        assertThat(context.getAnswerMessageList()).hasSize(1);
        assertThat(context.getReasonMessageList().get(0).getSeq()).isEqualTo(1L);
        assertThat(context.getAnswerMessageList().get(0).getSeq()).isEqualTo(2L);
    }

    @Test
    void recordAnswerStruct_updatesToolCallAfterSnapshotRestore() {
        MessageContext original = new MessageContext();
        original.recordAnswerStruct(answerDelta("{\"title\":\"Bash\"}", "tool-A", "3015"));

        MessageContext restored = new MessageContext();
        restored.setAnswerMessageList(original.getAnswerMessageList());
        restored.restoreSegmentCursor();
        String completed = restored.recordAnswerStruct(
            answerDelta("{\"output\":\"done\",\"status\":\"_DONE_\"}", "tool-A", "3015"));

        assertThat(restored.getAnswerMessageList()).hasSize(1);
        assertThat(restored.getAnswerMessageList().get(0).getSeq()).isEqualTo(1L);
        assertThat(JSON.parseObject(contentAt(restored.getAnswerMessageList(), 0))).containsEntry("title", "Bash")
            .containsEntry("output", "done");
        assertThat(JSON.parseObject(completed).getLong("seq")).isEqualTo(1L);
    }

    @Test
    void recordInferLog_updatesExistingThinkStatusTitleAcrossInterveningSegment() {
        MessageContext context = new MessageContext();

        context.recordInferLog(answerDeltaWithStatus("Running", "status-A", "3009", "_START_"));
        context.recordInferLog(answerDelta("details", "text-B", "1002"));
        String completed = context.recordInferLog(answerDeltaWithStatus("Done", "status-A", "3009", "_DONE_"));

        assertThat(context.getReasonMessageList()).hasSize(2);
        assertThat(context.getReasonMessageList().get(0).getSeq()).isEqualTo(1L);
        assertThat(context.getReasonMessageList().get(0).getStatus()).isEqualTo("_DONE_");
        assertThat(contentAt(context.getReasonMessageList(), 0)).isEqualTo("Done");
        assertThat(context.getReasonMessageList().get(1).getSeq()).isEqualTo(2L);
        assertThat(JSON.parseObject(completed).getLong("seq")).isEqualTo(1L);
    }

    @Test
    void restoreSegmentCursor_continuesAfterHighestSequence() {
        MessageContext context = new MessageContext();
        context.recordInferLog(answerDelta("thought", "A"));
        context.recordAnswerStruct(answerDelta("answer", "B", "3009"));

        MessageContext restored = new MessageContext();
        restored.setReasonMessageList(context.getReasonMessageList());
        restored.setAnswerMessageList(context.getAnswerMessageList());
        restored.restoreSegmentCursor();
        restored.recordInferLog(answerDelta("next", "C"));

        assertThat(restored.getReasonMessageList()).hasSize(2);
        assertThat(restored.getReasonMessageList().get(1).getSeq()).isEqualTo(3L);
    }

    @Test
    void restoreSegmentCursor_acceptsPersistedSegmentsWithoutReplacingCurrentLists() {
        AnswerDelta oldThink = JSON.parseObject(answerDelta("old thought", "A"), AnswerDelta.class);
        oldThink.setSeq(7L);
        oldThink.setEventType("reasoningLogDelta");
        AnswerDelta oldAnswer = JSON.parseObject(answerDelta("old answer", "B", "3009"), AnswerDelta.class);
        oldAnswer.setSeq(8L);
        oldAnswer.setEventType("answerDelta");

        MessageContext context = new MessageContext();
        context.restoreSegmentCursor(List.of(oldThink), List.of(oldAnswer));
        context.recordInferLog(answerDelta("new thought", "C"));

        assertThat(context.getReasonMessageList()).hasSize(1);
        assertThat(context.getReasonMessageList().get(0).getSeq()).isEqualTo(9L);
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

    private static String answerDeltaWithStatus(String content, String orderId, String contentType, String status) {
        AnswerDelta answerDelta = JSON.parseObject(answerDelta(content, orderId, contentType), AnswerDelta.class);
        answerDelta.setStatus(status);
        return JSON.toJSONString(answerDelta);
    }

    private static String contentAt(List<AnswerDelta> answerDeltas, int index) {
        return answerDeltas.get(index).getChoices().get(0).getDelta().getContent();
    }
}
