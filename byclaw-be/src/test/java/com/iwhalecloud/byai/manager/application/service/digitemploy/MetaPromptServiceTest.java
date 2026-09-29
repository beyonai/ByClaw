package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateRequest;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MetaPromptServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();

    private MetaPromptService service(AIService ai) {
        MetaPromptService service = new MetaPromptService();
        ResourceAuthApplicationService resources = mock(ResourceAuthApplicationService.class);
        PageInfo page = mock(PageInfo.class);
        when(page.getList()).thenReturn(List.of());
        when(resources.listResourceAuth(any())).thenReturn(page);
        ReflectionTestUtils.setField(service, "resourceAuthApplicationService", resources);
        ReflectionTestUtils.setField(service, "byaiSystemConfigService", mock(ByaiSystemConfigService.class));
        ReflectionTestUtils.setField(service, "aiService", ai);
        return service;
    }

    @Test
    void streamsPagePromptKeysAndKeepsCustomMetadata() throws Exception {
        AIService ai = mock(AIService.class);
        MetaPromptGenerateRequest request = new MetaPromptGenerateRequest();
        request.setAgentName("语文老师");
        request.setAgentType("001");
        request.setModelCode("selected-model");
        request.setCoreCompetencies("[{\"coreCompetency\":\"制定教学计划\"}]");
        request.setAgentTags("[\"教学\"]");
        request.setCorePersonaDefinition(mapper.writeValueAsString(List.of(
            Map.of("key", "memory", "name", "记忆规范", "value", "已有记忆"),
            Map.of("key", "custom", "name", "教学要求", "tip", "保留提示", "value", "已有要求"))));
        String generated = mapper.writeValueAsString(Map.of(
            "agentDescription", "生成描述",
            "coreCompetencies", request.getCoreCompetencies(),
            "corePersonaDefinition", List.of(Map.of("key", "custom", "name", "其他名称", "value", "新的教学要求"))));
        when(ai.generateTextStream(anyString(), anyString(), eq("selected-model"), anyInt(), any()))
            .thenReturn(generated);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        service(ai).generateV3Stream(request, output);
        String stream = output.toString(StandardCharsets.UTF_8);
        assertThat(stream).contains("event: start", "event: finalFields", "event: done").doesNotContain("event: error");
        String finalJson = stream.split("event: finalFields\ndata: ")[1].split("\n\n")[0];
        var fields = mapper.readTree(finalJson);
        var configs = mapper.readTree(fields.get("corePersonaDefinition").asText());
        assertThat(configs.size()).isEqualTo(2);
        assertThat(configs.get(0).get("key").asText()).isEqualTo("memory");
        assertThat(configs.get(0).get("value").asText()).isEqualTo("已有记忆");
        assertThat(configs.get(1).get("name").asText()).isEqualTo("教学要求");
        assertThat(configs.get(1).get("value").asText()).isEqualTo("新的教学要求");
        assertThat(configs.get(1).get("tip").asText()).isEqualTo("保留提示");
        verify(ai).generateTextStream(anyString(), contains("制定教学计划"), eq("selected-model"), anyInt(), any());
    }

    @Test
    void reportsModelFailureOnlyAsSseWithoutSuccessOrLeakingUpstreamDetails() throws Exception {
        AIService ai = mock(AIService.class);
        when(ai.generateTextStream(anyString(), anyString(), any(), anyInt(), any()))
            .thenThrow(new AIService.ModelSelectionException());
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        service(ai).generateV3Stream(new MetaPromptGenerateRequest(), output);
        assertThat(output.toString(StandardCharsets.UTF_8))
            .contains("event: error", "MODEL_NOT_AVAILABLE", "diagnosticId")
            .doesNotContain("event: finalFields", "event: done", "Selected model is unavailable", "\"success\":false");
    }
}
