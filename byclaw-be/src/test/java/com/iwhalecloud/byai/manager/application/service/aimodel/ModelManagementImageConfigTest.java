package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class ModelManagementImageConfigTest {

    @Mock
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Mock
    private ByaiTagRelationService byaiTagRelationService;

    @Mock
    private ByaiSystemConfigService byaiSystemConfigService;

    @InjectMocks
    private ModelManagementApplicationService service;

    private StaticApplicationContext context;

    @BeforeEach
    void setUp() {
        context = new StaticApplicationContext();
        StaticMessageSource messages = context.getStaticMessageSource();
        messages.addMessage("aimodel.image.config.invalid", Locale.ENGLISH, "Invalid image config");
        messages.addMessage("aimodel.debug.image.personal.required", Locale.ENGLISH, "Personal image model required");
        LocaleContextHolder.setLocale(Locale.ENGLISH);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", context);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", null);
        context.close();
    }

    @Test
    void roundTripsImageDefaultsAndUnknownKeysWithoutChangingExtensionJson() {
        ModelUpsertRequest request = request();
        request.setImageGenerationConfig(Map.of("size", "2K", "watermark", false, "futureOption", Map.of("x", 1)));
        request.setExtendParam("{\"customOption\":true}");
        captureSave();

        service.upsertModel(request, 42L);
        ModelVO detail = service.getModelDetail("901");
        assertThat(detail.getImageGenerationConfig()).isEqualTo(request.getImageGenerationConfig());
        assertThat(detail.getExtendParam()).isEqualTo(request.getExtendParam());
        assertThat(detail.getModelCode()).isEqualTo("doubao-seedream-4-0-250828");
        assertThat(detail.getModelProtocol()).isEqualTo("VOLCENGINE_IMAGE");
    }

    @Test
    void legacyClientEditPreservesOptionalConfigAndExplicitEmptyValuesClearIt() throws Exception {
        ModelUpsertRequest original = request();
        original.setImageGenerationConfig(Map.of("size", "4K", "watermark", false));
        original.setExtendParam("{\"customOption\":true}");
        captureSave();
        service.upsertModel(original, 42L);
        when(byaiSystemConfigService.findByParamCode("MODEL_QUOTA")).thenReturn("{}");

        ModelUpsertRequest legacyEdit = request();
        legacyEdit.setId("901");
        legacyEdit.setDisplayName("Renamed image model");
        service.upsertModel(legacyEdit, 42L);
        assertThat(service.getModelDetail("901").getImageGenerationConfig()).isEqualTo(original.getImageGenerationConfig());
        assertThat(service.getModelDetail("901").getExtendParam()).isEqualTo(original.getExtendParam());

        legacyEdit.setImageGenerationConfig(Map.of());
        legacyEdit.setExtendParam("");
        service.upsertModel(legacyEdit, 42L);
        assertThat(service.getModelDetail("901").getImageGenerationConfig()).isEmpty();
        assertThat(service.getModelDetail("901").getExtendParam()).isEmpty();

        // Jackson 必须区分未提交 extendParam 与显式 null，不能改变旧清空请求的行为。
        ObjectMapper mapper = new ObjectMapper();
        assertThat(mapper.readValue("{}", ModelUpsertRequest.class).isExtendParamProvided()).isFalse();
        ModelUpsertRequest explicitNull = mapper.readValue("{\"extendParam\":null}", ModelUpsertRequest.class);
        assertThat(explicitNull.isExtendParamProvided()).isTrue();
        assertThat(mapper.writeValueAsString(explicitNull)).doesNotContain("extendParamProvided");
        legacyEdit.setExtendParam(null);
        service.upsertModel(legacyEdit, 42L);
        assertThat(service.getModelDetail("901").getExtendParam()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"LLM", "EMBEDDING", "RERANK", "IMAGE_GENERATION"})
    void oldModelsAreSavedWithoutIntroducingImageDefaults(String type) {
        ModelUpsertRequest request = request();
        request.setModelType(type);
        request.setModelProtocol("IMAGE_GENERATION".equals(type) ? "MINIMAX_IMAGE" : "OpenAI");
        request.setProviderName("IMAGE_GENERATION".equals(type) ? "MINIMAX" : "OpenAI");
        request.setContextTokens(4096);
        captureSave();
        service.upsertModel(request, 42L);

        ByaiAimodel saved = byaiAimodelDomainService.getById(901L);
        assertThat(JSONObject.parseObject(saved.getInParams())).doesNotContainKey("imageGenerationConfig");
        assertThat(service.getModelDetail("901").getModelProtocol()).isEqualTo(request.getModelProtocol());
        assertThat(service.getModelDetail("901").getImageGenerationConfig()).isNull();
    }

    @Test
    void rejectsInvalidNewDefaultsBeforeSaving() {
        ModelUpsertRequest request = request();
        request.setImageGenerationConfig(Map.of("responseFormat", "base64"));
        assertThatThrownBy(() -> service.upsertModel(request, 42L))
            .isInstanceOf(BaseException.class).hasMessageContaining("Invalid image config");
    }

    @ParameterizedTest
    @ValueSource(strings = {"LLM", "EMBEDDING", "RERANK"})
    void nonImageModelsMayOmitProviderWithoutChangingConnection(String type) {
        ModelUpsertRequest request = request();
        request.setModelType(type);
        request.setModelProtocol("OpenAI");
        request.setProviderName(null);
        request.setContextTokens(4096);
        captureSave();
        service.upsertModel(request, 42L);

        ModelVO detail = service.getModelDetail("901");
        assertThat(detail.getProviderName()).isNull();
        assertThat(detail.getModelProtocol()).isEqualTo("OpenAI");
        assertThat(detail.getModelCode()).isEqualTo(request.getModelCode());
        assertThat(detail.getApiEndpoint()).isEqualTo(request.getApiEndpoint());
    }

    @ParameterizedTest
    @CsvSource({
        "COMFY_IMAGE, COMFYUI", "DEEPINFRA_IMAGE, DEEPINFRA", "FAL_IMAGE, FAL", "GOOGLE_IMAGE, GOOGLE",
        "LITELLM_IMAGE, LITELLM", "MICROSOFT_FOUNDRY_IMAGE, MICROSOFT_FOUNDRY", "MINIMAX_IMAGE, MINIMAX",
        "OPENAI_IMAGE, OPENAI", "OPENROUTER_IMAGE, OPENROUTER", "VYDRA_IMAGE, VYDRA", "XAI_IMAGE, XAI",
        "VOLCENGINE_IMAGE, VOLCENGINE"
    })
    void missingImageProviderIsPersistedFromExplicitProtocol(String protocol, String provider) {
        ModelUpsertRequest request = request();
        request.setModelProtocol(protocol);
        request.setProviderName(null);
        captureSave();
        service.upsertModel(request, 42L);

        ModelVO detail = service.getModelDetail("901");
        assertThat(detail.getProviderName()).isEqualTo(provider);
        assertThat(JSONObject.parseObject(byaiAimodelDomainService.getById(901L).getInParams()).getString("providerName"))
            .isEqualTo(provider);
        assertThat(detail.getModelProtocol()).isEqualTo(protocol);
        assertThat(detail.getModelCode()).isEqualTo(request.getModelCode());
        assertThat(detail.getApiEndpoint()).isEqualTo(request.getApiEndpoint());
    }

    @ParameterizedTest
    @ValueSource(strings = {"OpenAI", "Qwen", "OPENAI_COMPATIBLE_IMAGE", "UNKNOWN_IMAGE"})
    void legacySaveApiDoesNotInventAProviderForGenericProtocols(String protocol) {
        // 界面提示用户补充，但不能给旧 API 调用新增必填限制或默认成 MiniMax。
        ModelUpsertRequest request = request();
        request.setModelProtocol(protocol);
        request.setProviderName(null);
        captureSave();
        service.upsertModel(request, 42L);
        assertThat(service.getModelDetail("901").getProviderName()).isNull();
        assertThat(service.getModelDetail("901").getModelProtocol()).isEqualTo(protocol);
    }

    @ParameterizedTest
    @ValueSource(strings = {"DOUBAO", "MINIMAX", "custom-provider"})
    void editingAnImageModelPreservesAnExplicitProviderEvenIfItDiffersFromTheProtocol(String provider) {
        ModelUpsertRequest request = request();
        request.setProviderName(provider);
        captureSave();
        service.upsertModel(request, 42L);
        when(byaiSystemConfigService.findByParamCode("MODEL_QUOTA")).thenReturn("{}");
        request.setId("901");
        request.setDisplayName("Renamed model");
        service.upsertModel(request, 42L);

        ModelVO detail = service.getModelDetail("901");
        assertThat(detail.getProviderName()).isEqualTo(provider);
        assertThat(detail.getModelProtocol()).isEqualTo(request.getModelProtocol());
        assertThat(detail.getApiEndpoint()).isEqualTo(request.getApiEndpoint());
    }

    @Test
    void personalImageDebugRequiresTheOwnerAndImageType() {
        ByaiAimodel model = new ByaiAimodel();
        model.setCreateBy(42L);
        model.setOwnerType("PERSONAL");
        model.setModelType("IMAGE_GENERATION");
        when(byaiAimodelDomainService.getById(901L)).thenReturn(model);
        service.validatePersonalImageDebugAccess(901L, 42L);
        assertThatThrownBy(() -> service.validatePersonalImageDebugAccess(901L, 43L)).isInstanceOf(BaseException.class);
        assertThatThrownBy(() -> service.validatePersonalImageDebugAccess(901L, null)).isInstanceOf(BaseException.class);
        model.setOwnerType("PUBLIC");
        assertThatThrownBy(() -> service.validatePersonalImageDebugAccess(901L, 42L)).isInstanceOf(BaseException.class);
        model.setOwnerType("PERSONAL");
        model.setModelType("LLM");
        assertThatThrownBy(() -> service.validatePersonalImageDebugAccess(901L, 42L)).isInstanceOf(BaseException.class);
    }

    private void captureSave() {
        when(byaiAimodelDomainService.upsert(any(ByaiAimodel.class))).thenAnswer(invocation -> {
            ByaiAimodel saved = invocation.getArgument(0);
            saved.setModelId(901L);
            when(byaiAimodelDomainService.getById(901L)).thenReturn(saved);
            return 901L;
        });
    }

    private ModelUpsertRequest request() {
        ModelUpsertRequest request = new ModelUpsertRequest();
        request.setDisplayName("Seedream image");
        request.setModelCode("doubao-seedream-4-0-250828");
        request.setModelType("IMAGE_GENERATION");
        request.setModelProtocol("VOLCENGINE_IMAGE");
        request.setProviderName("VOLCENGINE");
        request.setStatus("DISABLED");
        request.setApiEndpoint("https://ark.cn-beijing.volces.com/api/v3/images/generations");
        request.setApiToken("test-token-not-a-secret");
        return request;
    }
}
