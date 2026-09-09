package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.SessionModelSelection;

@ExtendWith(MockitoExtension.class)
class SessionModelSelectionServiceTest {

    private static final Long USER_ID = 88L;

    @Mock
    private ByaiAimodelMapper byaiAimodelMapper;

    @Mock
    private AiModelService aiModelService;

    @Mock
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Mock
    private StringRedisTemplate stringRedisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @InjectMocks
    private SessionModelSelectionService service;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(USER_ID);
        loginInfo.setUserCode("user88");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolve_validPublicModelReturnsSelection() {
        when(byaiAimodelMapper.selectById(10L)).thenReturn(model(10L, "PUBLIC", "LLM", null));
        when(aiModelService.getModel("10")).thenReturn(modelDto("deepseek-v4-flash", "lwt-deepseek", "DeepSeek"));

        SessionModelSelection selection = service.resolve("10").orElseThrow(AssertionError::new);

        assertThat(selection.getModelId()).isEqualTo("10");
        assertThat(selection.getModelCode()).isEqualTo("deepseek-v4-flash");
        assertThat(selection.getModelName()).isEqualTo("lwt-deepseek");
        assertThat(selection.getProviderName()).isEqualTo("DeepSeek");
    }

    @Test
    void resolve_negativeStoredModelIdReturnsSelection() {
        when(byaiAimodelMapper.selectById(-2000L)).thenReturn(model(-2000L, "PUBLIC", "LLM", null));
        when(aiModelService.getModel("-2000")).thenReturn(modelDto("MiniMax-M3", "MiniMax-M3-2000", "OpenAI"));

        SessionModelSelection selection = service.resolve("-2000").orElseThrow(AssertionError::new);

        assertThat(selection.getModelId()).isEqualTo("-2000");
        assertThat(selection.getModelCode()).isEqualTo("MiniMax-M3");
        assertThat(service.parseModelId("0")).isNull();
        assertThat(service.parseModelId("-1")).isNull();
        assertThat(service.parseModelId("-01")).isNull();
    }

    @Test
    void resolve_enabledDatabaseStatusReturnsSelection() {
        ByaiAimodel enabled = model(10L, "PUBLIC", "LLM", null);
        enabled.setStatus("OOA");
        when(byaiAimodelMapper.selectById(10L)).thenReturn(enabled);
        when(aiModelService.getModel("10")).thenReturn(modelDto("selected", "selected", null));

        AssistantChatDto dto = new AssistantChatDto();
        dto.setRelModelId("10");
        assertThat(service.resolveSelection(dto).map(SessionModelSelection::getModelId)).contains("10");
    }

    @Test
    void resolve_disabledAndTestingDatabaseStatusesRejected() {
        ByaiAimodel disabled = model(12L, "PUBLIC", "LLM", null);
        disabled.setStatus("OOX");
        ByaiAimodel testing = model(13L, "PUBLIC", "LLM", null);
        testing.setStatus("OOD");
        when(byaiAimodelMapper.selectById(12L)).thenReturn(disabled);
        when(byaiAimodelMapper.selectById(13L)).thenReturn(testing);

        assertThat(service.resolve("12")).isEmpty();
        assertThat(service.resolve("13")).isEmpty();
        verify(aiModelService, never()).getModel(any());
    }

    @Test
    void resolve_personalModelOwnedByCurrentUserAllowed() {
        when(byaiAimodelMapper.selectById(11L)).thenReturn(model(11L, "PERSONAL", "LLM", USER_ID));
        when(aiModelService.getModel("11")).thenReturn(modelDto("m", "m", null));

        assertThat(service.resolve("11")).isPresent();
    }

    @Test
    void resolve_personalModelOfOtherUserRejected() {
        when(byaiAimodelMapper.selectById(11L)).thenReturn(model(11L, "PERSONAL", "LLM", 999L));

        assertThat(service.resolve("11")).isEmpty();
        verify(aiModelService, never()).getModel(any());
    }

    @Test
    void resolve_disabledOrNonLlmOrUnknownRejected() {
        ByaiAimodel disabled = model(12L, "PUBLIC", "LLM", null);
        disabled.setStatus("0");
        when(byaiAimodelMapper.selectById(12L)).thenReturn(disabled);
        when(byaiAimodelMapper.selectById(13L)).thenReturn(model(13L, "PUBLIC", "EMBEDDING", null));
        when(byaiAimodelMapper.selectById(14L)).thenReturn(null);

        assertThat(service.resolve("12")).isEmpty();
        assertThat(service.resolve("13")).isEmpty();
        assertThat(service.resolve("14")).isEmpty();
    }

    @Test
    void resolve_missingRedisConfigRejected() {
        when(byaiAimodelMapper.selectById(15L)).thenReturn(model(15L, "PUBLIC", "LLM", null));
        when(aiModelService.getModel("15")).thenReturn(null);

        assertThat(service.resolve("15")).isEmpty();
    }

    @Test
    void resolve_defaultSignalAndNonNumericDesktopIdIgnored() {
        assertThat(service.resolve("-1")).isEmpty();
        assertThat(service.resolve("claude-sonnet-4")).isEmpty();
        assertThat(service.resolve("  ")).isEmpty();
        assertThat(service.resolve(null)).isEmpty();
        verify(byaiAimodelMapper, never()).selectById(any());
    }

    @Test
    void resolveSelection_validSelectionBecomesEffective() {
        AssistantChatDto dto = dto("20", 5L);
        when(byaiAimodelMapper.selectById(20L)).thenReturn(model(20L, "PUBLIC", "LLM", null));
        when(aiModelService.getModel("20")).thenReturn(modelDto("code20", "name20", "provider20"));

        assertThat(service.resolveSelection(dto).map(SessionModelSelection::getModelCode)).contains("code20");
        assertThat(dto.isSessionModelResolved()).isTrue();
    }

    @Test
    void resolveSelection_invalidPositiveFallsBackToConfiguredModelAndDeletesOverride() {
        AssistantChatDto dto = dto("21", 5L);
        when(byaiAimodelMapper.selectById(21L)).thenReturn(null);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setPrologue("{\"modelInfo\":{\"modelId\":31}}");
        when(ssResExtDigEmployeeService.findById(3L)).thenReturn(ext);
        when(aiModelService.getModel("31")).thenReturn(modelDto("configured", "configured", null));

        assertThat(service.resolveSelection(dto).map(SessionModelSelection::getModelCode)).contains("configured");
        service.applySessionOverride(dto);
        verify(stringRedisTemplate).delete("byai:chat:session_model:5");
    }

    @Test
    void resolveSelection_absentSignalUsesSessionOverride() {
        AssistantChatDto dto = dto(null, 6L);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("byai:chat:session_model:6"))
            .thenReturn("{\"modelId\":\"40\",\"modelCode\":\"session-code\",\"modelName\":\"session-name\"}");

        assertThat(service.resolveSelection(dto).map(SessionModelSelection::getModelCode)).contains("session-code");
        service.applySessionOverride(dto);
        verify(stringRedisTemplate, never()).delete(anyString());
        verify(valueOperations, never()).set(any(), any(), any(Duration.class));
    }

    @Test
    void resolveSelection_absentSignalWithoutOverrideFallsBackToDefaultModel() {
        AssistantChatDto dto = dto(null, 7L);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("byai:chat:session_model:7")).thenReturn(null);
        ModelDto defaultModel = modelDto("default-code", "default-name", null);
        defaultModel.setInstanceId("50");
        when(aiModelService.getDefaultChatModel()).thenReturn(defaultModel);

        assertThat(service.resolveSelection(dto).map(SessionModelSelection::getModelCode)).contains("default-code");
    }

    @Test
    void applySessionOverride_validSelectionWritesKeyWithTtl() {
        AssistantChatDto dto = dto("22", 8L);
        when(byaiAimodelMapper.selectById(22L)).thenReturn(model(22L, "PUBLIC", "LLM", null));
        when(aiModelService.getModel("22")).thenReturn(modelDto("code22", "name22", "p"));
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);

        service.applySessionOverride(dto);

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq("byai:chat:session_model:8"), json.capture(),
            eq(SessionModelSelectionService.SESSION_MODEL_TTL));
        assertThat(json.getValue()).contains("\"modelId\":\"22\"").contains("code22");
    }

    @Test
    void applySessionOverride_defaultSignalDeletesKey() {
        service.applySessionOverride(dto("-1", 9L));

        verify(stringRedisTemplate).delete("byai:chat:session_model:9");
        verify(stringRedisTemplate, never()).opsForValue();
    }

    @Test
    void resolveConfiguredModel_prefersPrologueOverDefault() {
        AssistantChatDto dto = dto(null, 10L);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setPrologue("{\"modelInfo\":{\"modelId\":60}}");
        when(ssResExtDigEmployeeService.findById(3L)).thenReturn(ext);
        when(aiModelService.getModel("60")).thenReturn(modelDto("employee-model", "employee-model", null));

        assertThat(service.resolveConfiguredModel(dto).map(SessionModelSelection::getModelCode))
            .contains("employee-model");
        verify(aiModelService, never()).getDefaultChatModel();
    }

    private AssistantChatDto dto(String relModelId, Long sessionId) {
        AssistantChatDto dto = new AssistantChatDto();
        dto.setRelModelId(relModelId);
        dto.setSessionId(sessionId);
        dto.setAgentId(3L);
        return dto;
    }

    private ByaiAimodel model(Long modelId, String ownerType, String modelType, Long createBy) {
        ByaiAimodel entity = new ByaiAimodel();
        entity.setModelId(modelId);
        entity.setOwnerType(ownerType);
        entity.setModelType(modelType);
        entity.setCreateBy(createBy);
        entity.setStatus("1");
        return entity;
    }

    private ModelDto modelDto(String code, String name, String provider) {
        ModelDto dto = new ModelDto();
        dto.setModelCode(code);
        dto.setModelName(name);
        dto.setProviderName(provider);
        return dto;
    }

    @Test
    void sessionModelKeyPrefixMatchesTheCrossRuntimeContract() {
        // 该字面量同时是 baiying-enhance / byai-channel 读取的 Redis 键前缀（见 @byclaw/chat/session-model-override）。
        assertThat(SessionModelSelectionService.SESSION_MODEL_KEY_PREFIX).isEqualTo("byai:chat:session_model:");
    }
}
