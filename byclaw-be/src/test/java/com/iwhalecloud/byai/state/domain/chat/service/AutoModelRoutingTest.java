package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.state.application.service.limit.TokenQuotaService;
import com.iwhalecloud.byai.state.domain.chat.model.SessionModelSelection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.assertj.core.api.Assertions.*;

class AutoModelRoutingTest extends I18nTestSupport {
    private String decision(double confidence) {
        return """
            {"answers":{"selectedModel":{"type":"choice","choice":"model_42","confidence":%s,
              "probabilities":{"model_42":0.8,"model_43":0.2}}}}
            """.formatted(confidence);
    }

    @Test void confidenceIsDistinctFromChoiceProbabilityAndTriggersFallback() {
        var config = new AutoModelRoutingProperties();
        assertThat(config.getTimeoutMs()).isEqualTo(5000);
        var low = parse(decision(0.49), config);
        assertThat(low.uncertain()).isTrue();
        assertThat(low.modelId()).isEqualTo("42");
        assertThat(parse(decision(0.9), config).uncertain()).isFalse();
        assertThat(parse(decision(0.9).replace("0.8", "0.55").replace("0.2", "0.45"), config).uncertain()).isTrue();
    }

    private AutoModelRoutingService.Decision parse(String raw, AutoModelRoutingProperties config) {
        return AutoModelRoutingService.parseDecision(JSON.parseObject(raw), config, java.util.Set.of("42", "43"));
    }

    @Test void rejectsInvalidProbabilitiesUnknownModelsAndIncorrectWinner() {
        var config = new AutoModelRoutingProperties();
        for (String invalid : List.of(decision(0.9).replace("0.8", "1.8"),
            decision(0.9).replace("model_42", "model_99"), decision(0.9).replace("0.8", "0.2").replace("model_43\":0.2", "model_43\":0.8"),
            decision(0.9).replace("0.2", "0.1"), decision(1.1))) {
            assertThatThrownBy(() -> parse(invalid, config)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void evaluationIncludesConcreteCandidatesWithoutInventingCostOrQuality() {
        Map<String, Object> candidate = Map.of("modelId", "42", "modelCode", "qwen-example", "supportsImages", true,
            "supportsTools", true, "contextTokens", 128000, "description", "");
        Map<String, Object> state = Map.of("currentMessage", "Fix this page", "candidateModels", List.of(candidate));
        var body = JevDecisionClient.buildEvaluation(state);
        var json = JSON.parseObject(JSON.toJSONString(body));
        assertThat(json.getJSONObject("questions").getJSONObject("selectedModel").getJSONObject("criteria").keySet())
            .containsExactly("model_42");
        assertThat(JSON.toJSONString(body)).contains("qwen-example", "contextTokens").doesNotContain("costTier", "profiles", "authToken");
        assertThatThrownBy(() -> JevDecisionClient.buildEvaluation(Map.of("candidateModels", List.of(candidate, candidate))))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void autoIsAdvertisedWithoutAnyGatewayOrCandidateConfiguration() {
        var jev = mock(JevDecisionClient.class);
        var models = mock(AiModelService.class);
        var routing = new AutoModelRoutingService(new AutoModelRoutingProperties(), jev, models,
            mock(TokenQuotaService.class), mock(StringRedisTemplate.class), mock(ParamService.class));
        assertThat(routing.capabilities()).containsEntry("autoAvailable", true).containsEntry("gatewayConfigured", false);
        verifyNoInteractions(models);
        assertThat(new JevDecisionClient(new AutoModelRoutingProperties(), "synthetic-test-key").configured()).isTrue();
    }

    @Test void missingGatewayKeyProducesAnActionableError() {
        var fixture = new RoutingFixture();
        when(fixture.jev.configured()).thenReturn(false);
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            assertThatThrownBy(() -> fixture.route("no-key"))
                .isInstanceOfSatisfying(AutoModelRoutingService.RoutingException.class, error -> {
                    assertThat(error.getErrorCode()).isEqualTo("AUTO_GATEWAY_KEY_MISSING");
                    assertThat(error.getMessage()).contains("AI_GATEWAY_API_KEY");
                });
        }
    }

    @Test void inaccessibleModelsAreExcludedFromAutomaticSelection() throws Exception {
        var fixture = new RoutingFixture();
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            fixture.dto.setClientRequestId("private-model");
            var chosen = fixture.routing.route(fixture.dto, id -> "43".equals(id) ?
                Optional.of(new SessionModelSelection(id, "test-model", "Test", "Test")) : Optional.empty());
            assertThat(chosen.getModelId()).isEqualTo("43");
            verify(fixture.jev, never()).evaluate(anyMap());
        }
    }

    @Test void aMalformedModelRecordDoesNotBlockOtherEnabledModels() throws Exception {
        var fixture = new RoutingFixture();
        when(fixture.hash.get(anyString(), eq("42"))).thenReturn("invalid-json");
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            assertThat(fixture.route("malformed-record").getModelId()).isEqualTo("43");
            verify(fixture.jev, never()).evaluate(anyMap());
        }
    }

    @Test void autoCannotCarryAnOldManualModelOrThinkingLevel() {
        var dto = new AssistantChatDto();
        dto.setModelSelectionMode("auto");
        AutoModelRoutingService.validate(dto);
        dto.setRelModelId("42");
        assertThatThrownBy(() -> AutoModelRoutingService.validate(dto))
            .isInstanceOfSatisfying(AutoModelRoutingService.RoutingException.class, error -> assertThat(error.getErrorCode()).isEqualTo("INVALID_MODEL_SELECTION"));
        dto.setRelModelId(null);
        dto.setRelThinkingLevel("high");
        assertThatThrownBy(() -> AutoModelRoutingService.validate(dto))
            .isInstanceOfSatisfying(AutoModelRoutingService.RoutingException.class, error -> assertThat(error.getErrorCode()).isEqualTo("INVALID_MODEL_SELECTION"));
        dto.setModelSelectionMode(null);
        AutoModelRoutingService.validate(dto);
    }

    @Test void concreteChoiceLowConfidenceAndNetworkFailurePersistOnlyRunSnapshots() throws Exception {
        var fixture = new RoutingFixture();
        when(fixture.jev.evaluate(anyMap())).thenReturn(JSON.parseObject(decision(0.9)))
            .thenReturn(JSON.parseObject(decision(0.49))).thenThrow(new java.io.IOException("timeout"));
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            var selected = fixture.route("req-1");
            assertThat(selected.getModelId()).isEqualTo("42");
            assertThat(selected.getModelRouting()).containsEntry("reason", "model_choice");
            var fallback = fixture.route("req-2");
            assertThat(fallback.getModelId()).isEqualTo("43");
            assertThat(fallback.getModelRouting()).containsEntry("reason", "uncertain_decision");
            assertThat(fixture.route("req-3").getModelRouting()).containsEntry("reason", "decision_failed");
            var state = org.mockito.ArgumentCaptor.forClass(Map.class);
            verify(fixture.jev, times(3)).evaluate(state.capture());
            String metadata = JSON.toJSONString(state.getValue().get("candidateModels"));
            assertThat(metadata).contains("test-model", "128000", "supportsImages").doesNotContain("synthetic-test-token", "example.com", "profiles");
            verify(fixture.values, never()).set(startsWith("byai:chat:session_model:"), anyString(), any(java.time.Duration.class));
            verify(fixture.values, atLeastOnce()).set(startsWith("byai:chat:run_model:"), anyString(), any(java.time.Duration.class));
        }
    }

    @Test void imageInputUsesExistingAbilityAndSkipsJevForOnlyCompatibleModel() throws Exception {
        var fixture = new RoutingFixture();
        fixture.second.setInstanceParam(Map.of("abilities", List.of("7")));
        fixture.publish(fixture.second);
        when(fixture.params.getChatHistories(1L, 3)).thenReturn(List.of(Map.of("role", "user", "content", "![page.png](https://example.com/page.png)")));
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            var result = fixture.route("image-request");
            assertThat(result.getModelId()).isEqualTo("43");
            assertThat(result.getModelRouting()).containsEntry("reason", "single_candidate");
            verify(fixture.jev, never()).evaluate(anyMap());
        }
    }

    @Test void disabledModelsAndInsufficientContextCannotEnterCandidatePool() throws Exception {
        var fixture = new RoutingFixture();
        fixture.first.setStatus(0);
        fixture.second.setMaxContentToken("100");
        fixture.publish(fixture.first); fixture.publish(fixture.second);
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            assertThatThrownBy(() -> fixture.route("invalid-pool"))
                .isInstanceOfSatisfying(AutoModelRoutingService.RoutingException.class,
                    error -> assertThat(error.getErrorCode()).isEqualTo("AUTO_NO_COMPATIBLE_MODEL"));
            verify(fixture.jev, never()).evaluate(anyMap());
        }
    }

    @Test void compatibleSystemDefaultIsFallbackWithoutProfiles() throws Exception {
        var fixture = new RoutingFixture();
        when(fixture.models.getDefaultChatModel()).thenReturn(fixture.second);
        when(fixture.jev.evaluate(anyMap())).thenThrow(new java.io.IOException("timeout"));
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            assertThat(fixture.route("default-fallback").getModelId()).isEqualTo("43");
        }
    }

    private class RoutingFixture {
        final AutoModelRoutingProperties config = new AutoModelRoutingProperties();
        final JevDecisionClient jev = mock(JevDecisionClient.class);
        final AiModelService models = mock(AiModelService.class);
        final ParamService params = mock(ParamService.class);
        final StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") final ValueOperations<String, String> values = mock(ValueOperations.class);
        @SuppressWarnings("unchecked") final org.springframework.data.redis.core.HashOperations<String, Object, Object> hash =
            mock(org.springframework.data.redis.core.HashOperations.class);
        final ModelDto first = model("42"), second = model("43");
        final AutoModelRoutingService routing;
        final AssistantChatDto dto = new AssistantChatDto();
        RoutingFixture() {
            when(jev.configured()).thenReturn(true);
            when(models.getModelList()).thenReturn(List.of(first, second));
            when(models.getDefaultChatModel()).thenReturn(second);
            when(params.supportsAutoRouting(10L)).thenReturn(true);
            when(params.getChatHistories(1L, 3)).thenReturn(List.of());
            when(redis.opsForValue()).thenReturn(values); when(redis.opsForHash()).thenReturn(hash);
            publish(first); publish(second);
            when(values.setIfAbsent(anyString(), anyString(), any(java.time.Duration.class))).thenReturn(true);
            routing = new AutoModelRoutingService(config, jev, models, mock(TokenQuotaService.class), redis, params);
            dto.setModelSelectionMode("auto"); dto.setSessionId(1L); dto.setAgentId(10L); dto.setChatContent("Fix complex code");
        }
        void publish(ModelDto model) { when(hash.get(anyString(), eq(model.getInstanceId()))).thenReturn(JSON.toJSONString(model)); }
        SessionModelSelection route(String requestId) {
            dto.setClientRequestId(requestId);
            return routing.route(dto, id -> Optional.of(new SessionModelSelection(id, "test-model", "Test", "Test")));
        }
    }

    @Test void resumeUsesItsTraceSnapshotRatherThanTheLatestSessionSelection() {
        var redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        Map<String, String> stored = new java.util.HashMap<>();
        doAnswer(invocation -> { stored.put(invocation.getArgument(0), invocation.getArgument(1)); return null; })
            .when(values).set(anyString(), anyString(), any(java.time.Duration.class));
        when(values.get(anyString())).thenAnswer(invocation -> stored.get(invocation.getArgument(0)));
        var routing = new AutoModelRoutingService(new AutoModelRoutingProperties(), mock(JevDecisionClient.class),
            mock(AiModelService.class), mock(TokenQuotaService.class), redis, mock(ParamService.class));
        var dto = new AssistantChatDto();
        dto.setSessionId(1L); dto.setAgentId(10L); dto.setModelSelectionMode("auto");
        dto.setSessionModelSelection(new SessionModelSelection("42", "model", "Model", "Provider"));
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(7L);
            routing.bindTrace(dto, "original-trace");
            dto.setModelSelectionMode("manual"); dto.setRelModelId("43");
            dto.setTraceId("original-trace"); dto.setActionType("RESUME");
            routing.restoreResumeMode(dto);
            assertThat(dto.getModelSelectionMode()).isEqualTo("auto");
            assertThat(dto.getRelModelId()).isNull();
            assertThat(stored.keySet()).allMatch(key -> key.startsWith("byai:chat:run_model:7:1:10:trace:"));
        }
    }

    private ModelDto model(String id) {
        ModelDto model = new ModelDto();
        model.setInstanceId(id); model.setModelCode("test-model"); model.setAuthToken("synthetic-test-token");
        model.setUrl("https://example.com/v1"); model.setMaxContentToken("128000");
        model.setStatus(1); model.setModelType("LLM");
        model.setInstanceParam(Map.of("abilities", List.of("3")));
        return model;
    }
}
