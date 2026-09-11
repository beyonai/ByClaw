package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.manager.entity.devloop.OperationTaskTemplate;
import com.iwhalecloud.byai.manager.mapper.devloop.OperationTaskTemplateMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OperationTaskTemplateServiceTest {
    @Mock private OperationTaskTemplateMapper mapper;
    @InjectMocks private OperationTaskTemplateService service;

    @ParameterizedTest
    @ValueSource(strings = {"knowledge", "object_discovery", "KNOWLEDGE"})
    void hidesRetiredTemplatesWithoutDeletingHistory(String type) {
        OperationTaskTemplate template = template(type);
        when(mapper.selectById(1L)).thenReturn(template);
        assertThat(service.get(1L)).isNull();
        assertThat(template.getDeleteFlag()).isEqualTo("0");
    }

    @Test
    void keepsCollectionTemplateAvailable() {
        OperationTaskTemplate template = template("collect");
        when(mapper.selectById(1L)).thenReturn(template);
        assertThat(service.get(1L)).isSameAs(template);
    }

    private OperationTaskTemplate template(String type) {
        OperationTaskTemplate template = new OperationTaskTemplate();
        template.setTemplateType(type);
        template.setDeleteFlag("0");
        return template;
    }
}
