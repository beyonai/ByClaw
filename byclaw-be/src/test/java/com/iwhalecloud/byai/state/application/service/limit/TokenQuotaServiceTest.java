package com.iwhalecloud.byai.state.application.service.limit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelOwnerType;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelSourceType;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;

@ExtendWith(MockitoExtension.class)
class TokenQuotaServiceTest {

    @Mock
    private ByaiAimodelMapper byaiAimodelMapper;

    @InjectMocks
    private TokenQuotaService tokenQuotaService;

    @Test
    void personalModelOwnedByUserIsNotSubjectToQuota() {
        when(byaiAimodelMapper.selectById(11L)).thenReturn(model("PERSONAL", null));

        assertThat(tokenQuotaService.isModelSubjectToQuotaByModelId(11L)).isFalse();
    }

    @Test
    void publicAndTokenSaverModelsAreSubjectToQuota() {
        when(byaiAimodelMapper.selectById(12L)).thenReturn(model(ModelOwnerType.PUBLIC, null));
        when(byaiAimodelMapper.selectById(13L)).thenReturn(model("PERSONAL", ModelSourceType.TOKEN_SAVER));

        assertThat(tokenQuotaService.isModelSubjectToQuotaByModelId(12L)).isTrue();
        assertThat(tokenQuotaService.isModelSubjectToQuotaByModelId(13L)).isTrue();
    }

    @Test
    void unknownOrMissingModelIsTreatedAsRestricted() {
        when(byaiAimodelMapper.selectById(14L)).thenReturn(null);

        assertThat(tokenQuotaService.isModelSubjectToQuotaByModelId(null)).isTrue();
        assertThat(tokenQuotaService.isModelSubjectToQuotaByModelId(14L)).isTrue();
    }

    private ByaiAimodel model(String ownerType, String sourceType) {
        ByaiAimodel entity = new ByaiAimodel();
        entity.setOwnerType(ownerType);
        entity.setSourceType(sourceType);
        return entity;
    }
}
