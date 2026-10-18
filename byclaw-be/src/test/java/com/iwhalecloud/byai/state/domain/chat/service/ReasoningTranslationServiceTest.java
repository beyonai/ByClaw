package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Set;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class ReasoningTranslationServiceTest {
    private final AIService ai = mock(AIService.class);
    private final AiModelService models = mock(AiModelService.class);
    private final SessionModelSelectionService selections = mock(SessionModelSelectionService.class);
    private final ReasoningTranslationService service = new ReasoningTranslationService(ai, models, selections);
    private final AssistantChatDto dto = new AssistantChatDto();
    private final MessageContext context = new MessageContext();

    @BeforeEach
    void setup() {
        dto.setTranslateReasoning(true);
        dto.setReasoningTranslationModelId("42");
        when(models.getModel("42")).thenReturn(new ModelDto());
        when(ai.generateJsonObjectWithMetadata(anyString(), anyString(), any(ModelDto.class), eq(8192), eq(30000)))
            .thenAnswer(invocation -> {
                String source = JSON.parseObject(invocation.getArgument(1, String.class)).getString("source");
                return new AIService.GeneratedText(JSON.toJSONString(java.util.Map.of("translation", "中文：" + source)), "stop");
            });
    }

    @Test
    void buffersSplitSentenceAndKeepsRawTextWithPersistedCheckpoint() {
        append("I need to check ");
        assertThat(project("reasoningLogDelta")).contains("pending");
        project("tokenCount");
        project("moduleStatus");
        verifyNoInteractions(ai);
        append("the logs. ");
        project("reasoningLogDelta");
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation().getText()).contains("中文：I need to check the logs.");
        assertThat(context.getReasonMessageList().getFirst().getChoices().getFirst().getDelta().getContent()).isEqualTo("I need to check the logs. ");
        var restored = JSON.parseArray(JSON.toJSONString(context.getReasonMessageList()), AnswerDelta.class);
        context.setReasonMessageList(restored);
        context.restoreSegmentCursor();
        project("reasoningLogDelta");
        verify(ai, times(1)).generateJsonObjectWithMetadata(anyString(), anyString(), any(), anyInt(), anyInt());
    }

    @Test
    void flushesTailAtAnswerBoundaryWithoutMixingAgentSegments() {
        append("First incomplete sentence");
        project("reasoningLogDelta");
        context.recordAnswerStruct(delta("1002", "Final answer"));
        project("answerDelta");
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation().getStatus()).isEqualTo("done");
        append("Second agent's thought");
        project("reasoningLogDelta");
        assertThat(context.getReasonMessageList()).hasSize(2);
        assertThat(context.getReasonMessageList().getLast().getReasoningTranslation().getText()).isEmpty();
    }

    @Test
    void skipsToolArgumentsAndPureJsonWithoutCallingTranslator() {
        context.recordInferLog(delta("3015", "{\"input\":\"English parameter\"}"));
        append("{\"query\":\"payment timeout\"}");
        project("reasoningLogEnd");
        verifyNoInteractions(ai);
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation()).isNull();
        assertThat(context.getReasonMessageList().getLast().getReasoningTranslation().getText())
            .isEqualTo("{\"query\":\"payment timeout\"}");
    }

    @Test
    void separatesDifferentAgentsEvenWhenOrderIdsAreMissing() {
        JSONObject first = JSON.parseObject(delta("1001", "First agent"));
        first.put("agentId", "agent-1");
        JSONObject second = JSON.parseObject(delta("1001", "Second agent"));
        second.put("agentId", "agent-2");
        context.recordInferLog(first.toJSONString());
        context.recordInferLog(second.toJSONString());
        project("reasoningLogDelta");
        assertThat(context.getReasonMessageList()).hasSize(2);
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation().getText()).contains("中文：First agent");
        assertThat(context.getReasonMessageList().getLast().getReasoningTranslation().getText()).isEmpty();
    }

    @Test
    void protectsParametersAcrossDeltasAndRejectsCorruptedPlaceholders() {
        append("I will call `search` with {\"query\":\"payment");
        project("reasoningLogDelta");
        verifyNoInteractions(ai);
        append(" timeout\"}. ");
        project("reasoningLogDelta");
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation().getText())
            .contains("`search`", "{\"query\":\"payment timeout\"}");
        var protectedText = ReasoningTranslationText.protect("Use `search`.");
        assertThatThrownBy(() -> protectedText.restore("使用搜索。"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> protectedText.restore(protectedText.masked() + protectedText.masked()))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void doesNotSplitCodeJsonDecimalsOrParentheses() {
        assertThat(ReasoningTranslationText.boundary("Use `a. b` and {\"x\":\"a. b\"} (see e.g. this)", false)).isZero();
        assertThat(ReasoningTranslationText.boundary("Version 1.2 is ready", false)).isZero();
        assertThat(ReasoningTranslationText.boundary("Line one\nline two", false)).isZero();
        assertThat(ReasoningTranslationText.boundary("A sentence. Next", false)).isEqualTo(11);
        assertThat(ReasoningTranslationText.boundary("Unclosed `code", true)).isEqualTo(14);
    }

    @Test
    void disabledSwitchIsAnExactPassThroughAndInvalidModelIsRejectedBeforeLaunch() {
        dto.setTranslateReasoning(false);
        append("English thought. ");
        assertThat(project("reasoningLogDelta")).isEqualTo("{}");
        verifyNoInteractions(ai, models);
        dto.setTranslateReasoning(true);
        assertThatThrownBy(() -> service.validate(dto)).hasMessageContaining("翻译模型");
    }

    @Test
    void truncatedOrFailedTranslationDoesNotLeakEnglishOrProviderError() {
        when(ai.generateJsonObjectWithMetadata(anyString(), anyString(), any(), anyInt(), anyInt()))
            .thenReturn(new AIService.GeneratedText("{\"translation\":\"截断\"}", "length"));
        append("Private English reasoning. ");
        String output = project("reasoningLogEnd");
        assertThat(output).contains("该段思考暂时无法转换为中文").doesNotContain("Private English");
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation().getStatus()).isEqualTo("failed");
    }

    @Test
    void pythonSseReturnsProjectionAndFlushesAtTerminalBeforeCompletion() {
        PythonSseService python = new PythonSseService();
        ReflectionTestUtils.setField(python, "reasoningTranslationService", service);
        var broadcasts = mock(com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(python, "multiDeviceBroadcastService", broadcasts);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ChatProcessContext ctx = new ChatProcessContext(output, dto);
        ctx.messageContext = context;
        ctx.userId = 7L;
        ctx.sessionId = 8L;
        JSONObject line = new JSONObject();
        line.put("event", "reasoningLogDelta");
        line.put("data", delta("1001", "Unfinished thought"));
        python.getContentFromPythonStreamV3(line.toJSONString(), output, context, Set.of(), ctx);
        assertThat(output.toString()).contains("reasoningTranslations", "pending");
        var event = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcasts).broadcastRawEvent(eq(7L), eq(8L), event.capture(), isNull(), any());
        assertThat(event.getValue().getString("data")).contains("reasoningTranslations", "pending");
        line.put("event", "appStreamResponse");
        line.put("data", "{}");
        python.getContentFromPythonStreamV3(line.toJSONString(), output, context, Set.of(), ctx);
        assertThat(output.toString()).contains("reasoningTranslation", "中文：Unfinished thought");
        assertThat(context.getReasonMessageList().getFirst().getReasoningTranslation().getStatus()).isEqualTo("done");
    }

    @Test
    void recoveryProjectsNewDeltasWithoutWritingToAnOutputStream() {
        PythonSseService python = new PythonSseService();
        ReflectionTestUtils.setField(python, "reasoningTranslationService", service);
        JSONObject line = new JSONObject();
        line.put("event", "reasoningLogDelta");
        line.put("data", delta("1001", "Recovered thought. "));
        python.accumulateTranslatedEvent(line.toJSONString(), context, dto);
        assertThat(context.getRecordedStreamEventData()).contains("reasoningTranslations", "中文：Recovered thought.");
        assertThat(context.getReasonMessageList().getFirst().getChoices().getFirst().getDelta().getContent())
            .isEqualTo("Recovered thought. ");
    }

    private void append(String text) { context.recordInferLog(delta("1001", text)); }
    private String project(String event) { return service.project(event, "{}", context, dto); }
    private static String delta(String type, String text) {
        AnswerDelta delta = new AnswerDelta();
        delta.setContentType(type);
        ChoiceDto choice = new ChoiceDto();
        choice.setDelta(new DeltaDto(text));
        delta.setChoices(List.of(choice));
        return JSON.toJSONString(delta);
    }
}
