package com.iwhalecloud.byai.manager.domain.aimodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

class AIServiceTest {

    @Test
    void deepSeekJsonRequestsUseNativeThinkingSwitchAndIgnoreReasoningContent() {
        RequestFixture fixture = fixture("DeepSeek", "deepseek-v4");
        fixture.server().expect(requestTo("https://model.example/chat/completions"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().json("""
                {
                  "temperature": 0.0,
                  "response_format": {"type": "json_object"},
                  "thinking": {"type": "disabled"}
                }
                """, false))
            .andRespond(withSuccess("""
                {
                  "choices": [{
                    "message": {
                      "reasoning_content": "private reasoning",
                      "content": "{\\\"ok\\\":true}"
                    },
                    "finish_reason": "stop"
                  }]
                }
                """, MediaType.APPLICATION_JSON));

        AIService.GeneratedText response = fixture.service()
            .generateJsonObjectWithMetadata("system", "user", fixture.model(), 4000);

        assertThat(response).isEqualTo(new AIService.GeneratedText("{\"ok\":true}", "stop"));
        fixture.server().verify();
    }

    @Test
    void qwenJsonRequestsUseEnableThinkingFalse() {
        assertRequestContains("Qwen", "qwen3.7-plus", """
            {"enable_thinking": false}
            """);
    }

    @Test
    void minimaxM3JsonRequestsUseNativeThinkingSwitchAndPositiveTemperature() {
        assertRequestContains("MiniMax", "MiniMax-M3", """
            {
              "temperature": 0.1,
              "thinking": {"type": "disabled"}
            }
            """);
    }

    @Test
    void minimaxM2SeparatesReasoningAndUsesPromptFallback() {
        assertRequestContains("MiniMax", "MiniMax-M2.7", """
            {
              "temperature": 0.1,
              "reasoning_split": true,
              "messages": [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "user\\n\\nDo not output analysis, reasoning, or <think> blocks. Return only the final JSON object."}
              ]
            }
            """);
    }

    @Test
    void togetherJsonRequestsDisableReasoning() {
        assertRequestContains("Together", "Qwen/Qwen3.5-9B", """
            {"reasoning": {"enabled": false}}
            """);
    }

    @Test
    void zaiJsonRequestsUseNativeThinkingSwitch() {
        assertRequestContains("ZAI", "glm-5.1", """
            {"thinking": {"type": "disabled"}}
            """);
    }

    @Test
    void openRouterJsonRequestsDisableAndExcludeReasoningWhenModelAllowsIt() {
        assertRequestContains("OpenRouter", "openai/gpt-5.2", """
            {"reasoning": {"effort": "none", "exclude": true}}
            """);
    }

    @Test
    void openRouterMandatoryReasoningModelsOnlyExcludeReasoningAndUsePromptFallback() {
        assertRequestContains("OpenRouter", "google/gemini-3.1-pro", """
            {
              "reasoning": {"exclude": true},
              "messages": [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "user\\n\\nDo not output analysis, reasoning, or <think> blocks. Return only the final JSON object."}
              ]
            }
            """);
    }

    @Test
    void openAiModelsThatSupportNoneUseReasoningEffort() {
        assertRequestContains("OpenAI", "gpt-5.2", """
            {"reasoning_effort": "none"}
            """);
    }

    @Test
    void gemini25FlashUsesReasoningEffortNone() {
        assertRequestContains("Google", "gemini-2.5-flash", """
            {
              "temperature": 1.0,
              "reasoning_effort": "none"
            }
            """);
    }

    @Test
    void unknownProvidersUseOnlyPromptFallback() {
        assertRequestContains("UnknownVendor", "future-model", """
            {
              "messages": [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "user\\n\\nDo not output analysis, reasoning, or <think> blocks. Return only the final JSON object."}
              ]
            }
            """);
    }

    private void assertRequestContains(String providerName, String modelCode, String expectedJson) {
        RequestFixture fixture = fixture(providerName, modelCode);
        fixture.server().expect(requestTo("https://model.example/chat/completions"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().json(expectedJson, false))
            .andRespond(withSuccess("""
                {"choices":[{"message":{"content":"{\\\"ok\\\":true}"},"finish_reason":"stop"}]}
                """, MediaType.APPLICATION_JSON));

        fixture.service().generateJsonObjectWithMetadata("system", "user", fixture.model(), 4000);

        fixture.server().verify();
    }

    private RequestFixture fixture(String providerName, String modelCode) {
        AIService service = new AIService();
        RestTemplate restTemplate = (RestTemplate) ReflectionTestUtils.getField(service, "restTemplate");
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        ModelDto model = new ModelDto();
        model.setUrl("https://model.example");
        model.setAuthToken("test-token");
        model.setModelCode(modelCode);
        model.setProviderName(providerName);
        model.setModelProtocol("OpenAI");
        return new RequestFixture(service, server, model);
    }

    private record RequestFixture(AIService service, MockRestServiceServer server, ModelDto model) {
    }
}
