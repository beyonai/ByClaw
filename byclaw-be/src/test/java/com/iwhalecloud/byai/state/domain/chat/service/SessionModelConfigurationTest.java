package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ModelConfigurationValidator;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class SessionModelConfigurationTest extends I18nTestSupport {
    @Test
    void existingSessionOverrideCannotBypassConfigurationValidation() {
        AiModelService models = mock(AiModelService.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(org.mockito.ArgumentMatchers.anyString()))
            .thenReturn("{\"modelId\":\"42\",\"modelCode\":\"model\"}");
        ModelDto model = new ModelDto();
        model.setUrl("https://example.com/v1");
        model.setAuthToken("请用户替换");
        model.setModelCode("model");
        when(models.getModel("42")).thenReturn(model);
        SessionModelSelectionService service = new SessionModelSelectionService(
            mock(ByaiAimodelMapper.class), models, mock(SsResExtDigEmployeeService.class), redis);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setSessionId(1L);
        assertThatThrownBy(() -> service.resolveSelection(dto))
            .isInstanceOf(ModelConfigurationValidator.InvalidModelConfigurationException.class)
            .hasMessageContaining("模型管理");
    }
}
