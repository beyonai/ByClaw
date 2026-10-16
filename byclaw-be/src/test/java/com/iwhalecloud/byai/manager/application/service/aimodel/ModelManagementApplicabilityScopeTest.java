package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ModelManagementApplicabilityScopeTest {

    @Mock
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Mock
    private ByaiTagRelationService byaiTagRelationService;

    @Mock
    private ByaiSystemConfigService byaiSystemConfigService;

    @InjectMocks
    private ModelManagementApplicationService service;

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"适用于内部知识问答\n支持中文资料", "For code generation"})
    void savesAndReadsScopeForNewAndExistingModels(String scope) {
        ModelUpsertRequest request = new ModelUpsertRequest();
        request.setDisplayName("Scope test model");
        request.setModelCode("test-model");
        request.setModelType("LLM");
        request.setContextTokens(4096);
        request.setStatus("DISABLED");
        request.setApiEndpoint("https://example.com/v1");
        request.setApiToken("test-token-not-a-secret");
        request.setApplicabilityScope(scope);

        // 通过保存与详情链路验证多行文本持久化，不要求新增数据库列。
        when(byaiAimodelDomainService.upsert(any(ByaiAimodel.class))).thenAnswer(invocation -> {
            ByaiAimodel saved = invocation.getArgument(0);
            saved.setModelId(901L);
            JSONObject inParams = JSONObject.parseObject(saved.getInParams());
            // 新增模型未提供任何可选参数时，in_params 可以为空；仍验证适用范围往返保持为空。
            assertThat(inParams == null ? null : inParams.getString("applicabilityScope")).isEqualTo(scope);
            when(byaiAimodelDomainService.getById(901L)).thenReturn(saved);
            return 901L;
        });

        service.upsertModel(request, 42L);
        assertThat(service.getModelDetail("901").getApplicabilityScope()).isEqualTo(scope);

        // 编辑覆盖已有说明，空字符串也必须能够覆盖旧值。
        ByaiAimodel existing = byaiAimodelDomainService.getById(901L);
        existing.setInParams("{\"applicabilityScope\":\"previous scope\"}");
        when(byaiSystemConfigService.findByParamCode("MODEL_QUOTA")).thenReturn("{}");
        request.setId("901");
        service.upsertModel(request, 42L);
        assertThat(service.getModelDetail("901").getApplicabilityScope()).isEqualTo(scope);
    }

    @Test
    void readsLegacyModelWithoutScope() {
        ByaiAimodel existing = new ByaiAimodel();
        existing.setModelId(902L);
        existing.setModelType("LLM");
        existing.setStatus("OOX");
        existing.setInParams("{\"systems\":[\"BY_CLAW\"]}");
        when(byaiAimodelDomainService.getById(902L)).thenReturn(existing);

        assertThat(service.getModelDetail("902").getApplicabilityScope()).isNull();
        assertThat(service.getModelDetail("902").getSystems()).containsExactly("BY_CLAW");
    }
}
