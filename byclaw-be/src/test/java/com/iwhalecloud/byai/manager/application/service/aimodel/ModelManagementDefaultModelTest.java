package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelDefault;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.tag.ByaiTagRelation;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ModelManagementDefaultModelTest {

    @Mock
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Mock
    private ByaiTagRelationService byaiTagRelationService;

    @InjectMocks
    private ModelManagementApplicationService service;

    @ParameterizedTest
    @ValueSource(strings = {"LLM", "EMBEDDING", "RERANK", "TTS", "IMAGE_GENERATION", "CUSTOM_TYPE"})
    void replacesAllDefaultsOfTheSameTypeAndPreservesOtherTypes(String modelType) {
        ByaiAimodel target = model(101L, modelType, "OOA");
        ByaiAimodel oldDefault = model(102L, modelType, "OOA");
        ByaiAimodel disabledDefault = model(103L, modelType, "OOX");
        ByaiAimodel otherTypeDefault = model(201L, "OTHER_TYPE", "OOA");
        Map<Long, ByaiAimodel> models = Map.of(101L, target, 102L, oldDefault, 103L, disabledDefault,
            201L, otherTypeDefault);
        when(byaiAimodelDomainService.findById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(anyLong()))
            .thenAnswer(invocation -> models.get(invocation.getArgument(0)));
        // 同类型存在多个旧默认（含停用记录）时，一次设置必须全部清除。
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L))
            .thenReturn(List.of(relation(1002L, 102L), relation(1003L, 103L), relation(2001L, 201L)));

        service.setDefaultModel(request(101L, modelType));

        verify(byaiTagRelationService).findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L);
        verify(byaiTagRelationService).removeById(1002L);
        verify(byaiTagRelationService).removeById(1003L);
        verify(byaiTagRelationService).save(Constants.OBJ_TYPE_AIMODEL, 101L, 1L);
        verifyNoMoreInteractions(byaiTagRelationService);
        verify(byaiAimodelDomainService).syncToRedis(oldDefault);
        verify(byaiAimodelDomainService).removeFromRedis(103L);
        verify(byaiAimodelDomainService).syncToRedis(target);
        verify(byaiAimodelDomainService, never()).syncToRedis(otherTypeDefault);
    }

    @Test
    void preservesOneTargetRelationAndRemovesDuplicateDefaults() {
        ByaiAimodel target = model(101L, "TTS", "OOA");
        ByaiAimodel oldDefault = model(102L, " tts ", "OOA");
        when(byaiAimodelDomainService.findById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(102L)).thenReturn(oldDefault);
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L))
            .thenReturn(List.of(relation(1001L, 101L), relation(1002L, 101L), relation(1003L, 102L)));

        service.setDefaultModel(request(101L, " tts "));

        verify(byaiTagRelationService).findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L);
        verify(byaiTagRelationService).removeById(1002L);
        verify(byaiTagRelationService).removeById(1003L);
        verifyNoMoreInteractions(byaiTagRelationService);
        verify(byaiAimodelDomainService).syncToRedis(target);
        verify(byaiAimodelDomainService).syncToRedis(oldDefault);
    }

    @Test
    void usesTheStoredTypeWhenRequestOmitsIt() {
        ByaiAimodel target = model(101L, "RERANK", "OOA");
        when(byaiAimodelDomainService.findById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(101L)).thenReturn(target);
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L)).thenReturn(List.of());

        service.setDefaultModel(request(101L, null));

        verify(byaiTagRelationService).save(Constants.OBJ_TYPE_AIMODEL, 101L, 1L);
    }

    @Test
    void rejectsARequestThatChangesTheStoredModelType() {
        when(byaiAimodelDomainService.findById(101L)).thenReturn(model(101L, "TTS", "OOA"));

        assertThatThrownBy(() -> service.setDefaultModel(request(101L, "LLM")))
            .isInstanceOf(BaseException.class);

        verifyNoInteractions(byaiTagRelationService);
    }

    @ParameterizedTest
    @ValueSource(strings = {"OOX", "OOD"})
    void rejectsNonEnabledModels(String status) {
        when(byaiAimodelDomainService.findById(101L)).thenReturn(model(101L, "TTS", status));

        assertThatThrownBy(() -> service.setDefaultModel(request(101L, "TTS")))
            .isInstanceOf(BaseException.class);

        verifyNoInteractions(byaiTagRelationService);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void replacesOnlyEmptyTypeDefaults(String modelType) {
        ByaiAimodel target = model(101L, modelType, "OOA");
        ByaiAimodel nullDefault = model(102L, null, "OOA");
        ByaiAimodel emptyDefault = model(103L, "", "OOA");
        ByaiAimodel blankDefault = model(104L, "   ", "OOA");
        ByaiAimodel llmDefault = model(201L, "LLM", "OOA");
        Map<Long, ByaiAimodel> models = Map.of(101L, target, 102L, nullDefault, 103L, emptyDefault,
            104L, blankDefault, 201L, llmDefault);
        when(byaiAimodelDomainService.findById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(anyLong()))
            .thenAnswer(invocation -> models.get(invocation.getArgument(0)));
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L))
            .thenReturn(List.of(relation(1002L, 102L), relation(1003L, 103L), relation(1004L, 104L),
                relation(2001L, 201L)));

        service.setDefaultModel(request(101L, modelType));

        verify(byaiTagRelationService).findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L);
        verify(byaiTagRelationService).removeById(1002L);
        verify(byaiTagRelationService).removeById(1003L);
        verify(byaiTagRelationService).removeById(1004L);
        verify(byaiTagRelationService).save(Constants.OBJ_TYPE_AIMODEL, 101L, 1L);
        verifyNoMoreInteractions(byaiTagRelationService);
        verify(byaiAimodelDomainService, never()).syncToRedis(llmDefault);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void settingLlmDefaultPreservesEmptyTypeDefault(String emptyType) {
        ByaiAimodel target = model(101L, "LLM", "OOA");
        ByaiAimodel emptyDefault = model(201L, emptyType, "OOA");
        when(byaiAimodelDomainService.findById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(101L)).thenReturn(target);
        when(byaiAimodelDomainService.getById(201L)).thenReturn(emptyDefault);
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L))
            .thenReturn(List.of(relation(2001L, 201L)));

        service.setDefaultModel(request(101L, "LLM"));

        verify(byaiTagRelationService, never()).removeById(2001L);
        verify(byaiTagRelationService).save(Constants.OBJ_TYPE_AIMODEL, 101L, 1L);
        verify(byaiAimodelDomainService, never()).syncToRedis(emptyDefault);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void emptyTypeDefaultDoesNotBecomeDefaultConversationAbility(String modelType) {
        ByaiAimodel target = model(101L, modelType, "OOA");
        target.setIsDefault(1);
        target.setInParams("{\"abilities\":[\"1\",\"3\"]}");
        when(byaiAimodelDomainService.getById(101L)).thenReturn(target);

        assertThat(service.getModelDetail("101").getAbilities()).containsExactly("3");
        assertThat(service.getModelDetail("101").getIsDefault()).isEqualTo(1);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void enablingEmptyTypeDoesNotAutomaticallyAssignLlmDefault(String modelType) {
        when(byaiAimodelDomainService.getById(101L)).thenReturn(model(101L, modelType, "OOA"));

        service.setModelStatus("101", "ENABLED");

        verify(byaiAimodelDomainService).setStatus(101L, "ENABLED");
        verifyNoInteractions(byaiTagRelationService);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void resolvesOnlyTheEmptyTypeDefault(String modelType) {
        ByaiAimodel emptyDefault = model(101L, modelType, "OOA");
        emptyDefault.setIsDefault(1);
        ByaiAimodel llmDefault = model(201L, "LLM", "OOA");
        llmDefault.setIsDefault(1);
        // 通用查询对空类型不加过滤，专用默认查询仍只能返回空类型。
        when(byaiAimodelDomainService.listModel(any(ModelRequest.class)))
            .thenReturn(List.of(llmDefault, emptyDefault));

        assertThat(service.getDefaultModelId(modelType)).isEqualTo("101");
        assertThat(service.getDefaultModelId()).isEqualTo("201");
    }

    @Test
    void missingEmptyTypeDefaultDoesNotFallBackToLlm() {
        ByaiAimodel llmDefault = model(201L, "LLM", "OOA");
        llmDefault.setIsDefault(1);
        when(byaiAimodelDomainService.listModel(any(ModelRequest.class))).thenReturn(List.of(llmDefault));

        assertThatThrownBy(() -> service.getDefaultModelId(""))
            .isInstanceOf(BaseException.class);
    }

    @Test
    void explicitEmptyTypeCannotSetAnLlmModelAsDefault() {
        when(byaiAimodelDomainService.findById(101L)).thenReturn(model(101L, "LLM", "OOA"));

        assertThatThrownBy(() -> service.setDefaultModel(request(101L, "")))
            .isInstanceOf(BaseException.class);

        verifyNoInteractions(byaiTagRelationService);
    }

    private static ByaiAimodel model(Long id, String modelType, String status) {
        ByaiAimodel model = new ByaiAimodel();
        model.setModelId(id);
        model.setModelType(modelType);
        model.setStatus(status);
        return model;
    }

    private static ByaiTagRelation relation(Long id, Long modelId) {
        ByaiTagRelation relation = new ByaiTagRelation();
        relation.setRelationId(id);
        relation.setObjType(Constants.OBJ_TYPE_AIMODEL);
        relation.setObjId(modelId);
        relation.setTagId(1L);
        return relation;
    }

    private static ModelDefault request(Long id, String modelType) {
        ModelDefault request = new ModelDefault();
        request.setModelId(id);
        request.setModelType(modelType);
        return request;
    }
}
