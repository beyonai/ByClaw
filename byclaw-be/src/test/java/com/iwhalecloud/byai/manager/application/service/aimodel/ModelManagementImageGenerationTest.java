package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelDefault;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.tag.ByaiTagRelation;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class ModelManagementImageGenerationTest {

    private static final Long LLM_DEFAULT_RELATION_ID = 1001L;

    private static final Long EMBEDDING_DEFAULT_RELATION_ID = 1002L;

    private static final Long IMAGE_DEFAULT_RELATION_ID = 1003L;

    @Mock
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Mock
    private ByaiTagRelationService byaiTagRelationService;

    @InjectMocks
    private ModelManagementApplicationService service;

    private StaticApplicationContext applicationContext;

    @BeforeEach
    void setUpMessages() {
        LocaleContextHolder.setLocale(Locale.ENGLISH);
        applicationContext = new StaticApplicationContext();
        StaticMessageSource messageSource = applicationContext.getStaticMessageSource();
        messageSource.addMessage("aimodel.default_model.delete.forbidden", Locale.ENGLISH,
            "Cannot delete the default {0} model.");
        messageSource.addMessage("aimodel.default_model.disable.forbidden", Locale.ENGLISH,
            "Cannot disable the default {0} model.");
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    @AfterEach
    void clearMessages() {
        LocaleContextHolder.resetLocaleContext();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", null);
        applicationContext.close();
    }

    @Test
    void imageGenerationDefaultIsResolvedAndReplacedWithoutChangingOtherTypes() {
        ByaiAimodel llmDefault = model(101L, "LLM", "OOA", 1);
        ByaiAimodel embeddingDefault = model(202L, "EMBEDDING", "OOA", 1);
        ByaiAimodel imageDefault = model(303L, "IMAGE_GENERATION", "OOA", 1);
        ByaiAimodel replacement = model(304L, "IMAGE_GENERATION", "OOA", 0);
        Map<Long, ByaiAimodel> models = Map.of(101L, llmDefault, 202L, embeddingDefault, 303L, imageDefault,
            304L, replacement);

        when(byaiAimodelDomainService.listModel(org.mockito.ArgumentMatchers.argThat(request ->
            Constants.STATUS_ENABLED.equals(request.getStatus()) && Long.valueOf(1L).equals(request.getTagId())
                && "IMAGE_GENERATION".equals(request.getModelType())))).thenReturn(List.of(imageDefault));
        when(byaiAimodelDomainService.findById(anyLong())).thenAnswer(invocation -> models.get(invocation.getArgument(0)));
        when(byaiAimodelDomainService.getById(anyLong())).thenAnswer(invocation -> models.get(invocation.getArgument(0)));
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L)).thenReturn(List.of(
            relation(LLM_DEFAULT_RELATION_ID, 101L), relation(EMBEDDING_DEFAULT_RELATION_ID, 202L),
            relation(IMAGE_DEFAULT_RELATION_ID, 303L)));

        assertThat(service.getDefaultModelId("IMAGE_GENERATION")).isEqualTo("303");

        service.setDefaultModel(modelDefault(304L, "IMAGE_GENERATION"));

        verify(byaiTagRelationService, never()).removeById(LLM_DEFAULT_RELATION_ID);
        verify(byaiTagRelationService, never()).removeById(EMBEDDING_DEFAULT_RELATION_ID);
        verify(byaiTagRelationService).removeById(IMAGE_DEFAULT_RELATION_ID);
        verify(byaiAimodelDomainService, never()).syncToRedis(llmDefault);
        verify(byaiAimodelDomainService, never()).syncToRedis(embeddingDefault);
        InOrder redisRefreshOrder = inOrder(byaiAimodelDomainService);
        redisRefreshOrder.verify(byaiAimodelDomainService).syncToRedis(imageDefault);
        redisRefreshOrder.verify(byaiAimodelDomainService).syncToRedis(replacement);
    }

    @Test
    void missingModelDefaultRelationIsPreservedWhenReplacingImageDefault() {
        ByaiAimodel imageDefault = model(303L, "IMAGE_GENERATION", "OOA", 1);
        ByaiAimodel replacement = model(304L, "IMAGE_GENERATION", "OOA", 0);
        Map<Long, ByaiAimodel> models = Map.of(303L, imageDefault, 304L, replacement);
        when(byaiAimodelDomainService.findById(304L)).thenReturn(replacement);
        when(byaiAimodelDomainService.getById(anyLong()))
            .thenAnswer(invocation -> models.get(invocation.getArgument(0)));
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L)).thenReturn(List.of(
            relation(IMAGE_DEFAULT_RELATION_ID, 303L), relation(1004L, 404L)));

        service.setDefaultModel(modelDefault(304L, "IMAGE_GENERATION"));

        verify(byaiTagRelationService).removeById(IMAGE_DEFAULT_RELATION_ID);
        verify(byaiTagRelationService, never()).removeById(1004L);
        verify(byaiAimodelDomainService, never()).removeFromRedis(404L);
    }

    @Test
    void disabledImageGenerationModelCannotBecomeDefault() {
        ByaiAimodel disabled = model(305L, "IMAGE_GENERATION", "OOX", 0);
        when(byaiAimodelDomainService.findById(305L)).thenReturn(disabled);

        assertThatThrownBy(() -> service.setDefaultModel(modelDefault(305L, "IMAGE_GENERATION")))
            .isInstanceOf(BaseException.class);

        verify(byaiAimodelDomainService, never()).syncToRedis(org.mockito.ArgumentMatchers.any(ByaiAimodel.class));
        verify(byaiAimodelDomainService, never()).removeFromRedis(anyLong());
        verifyNoInteractions(byaiTagRelationService);
    }

    @Test
    void imageGenerationDefaultCannotBeDeletedOrDisabled() {
        ByaiAimodel imageDefault = model(303L, "IMAGE_GENERATION", "OOA", 1);
        when(byaiAimodelDomainService.getById(303L)).thenReturn(imageDefault);
        when(byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L))
            .thenReturn(List.of(relation(IMAGE_DEFAULT_RELATION_ID, 303L)));

        assertThatThrownBy(() -> service.deleteModel("303")).isInstanceOf(BaseException.class)
            .hasMessageContaining("IMAGE_GENERATION");
        assertThatThrownBy(() -> service.setModelStatus("303", "DISABLED")).isInstanceOf(BaseException.class)
            .hasMessageContaining("IMAGE_GENERATION");

        verify(byaiAimodelDomainService, never()).deleteById(303L);
        verify(byaiAimodelDomainService, never()).setStatus(303L, "DISABLED");
    }

    @Test
    void imageGenerationModelCanBeSavedWithoutChatContextTokens() {
        ModelUpsertRequest request = new ModelUpsertRequest();
        request.setDisplayName("MiniMax image");
        request.setProviderName("MINIMAX");
        request.setModelProtocol("MINIMAX_IMAGE");
        request.setModelCode("image-01");
        request.setModelType("IMAGE_GENERATION");
        request.setStatus("DISABLED");
        request.setApiEndpoint("https://api.minimaxi.com/v1/image_generation");
        request.setApiToken("test-token-not-a-secret");
        when(byaiAimodelDomainService.upsert(org.mockito.ArgumentMatchers.any(ByaiAimodel.class))).thenReturn(901L);

        assertThat(service.upsertModel(request, 42L)).containsEntry("id", "901");

        ArgumentCaptor<ByaiAimodel> entityCaptor = ArgumentCaptor.forClass(ByaiAimodel.class);
        verify(byaiAimodelDomainService).upsert(entityCaptor.capture());
        assertThat(entityCaptor.getValue().getModelType()).isEqualTo("IMAGE_GENERATION");
        assertThat(entityCaptor.getValue().getMaxContentToken()).isNull();
    }

    private static ByaiAimodel model(Long modelId, String modelType, String status, int isDefault) {
        ByaiAimodel model = new ByaiAimodel();
        model.setModelId(modelId);
        model.setModelType(modelType);
        model.setStatus(status);
        model.setIsDefault(isDefault);
        return model;
    }

    private static ByaiTagRelation relation(Long relationId, Long modelId) {
        ByaiTagRelation relation = new ByaiTagRelation();
        relation.setRelationId(relationId);
        relation.setTagId(1L);
        relation.setObjId(modelId);
        relation.setObjType(Constants.OBJ_TYPE_AIMODEL);
        return relation;
    }

    private static ModelDefault modelDefault(Long modelId, String modelType) {
        ModelDefault modelDefault = new ModelDefault();
        modelDefault.setModelId(modelId);
        modelDefault.setTagId(1L);
        modelDefault.setModelType(modelType);
        return modelDefault;
    }

}
