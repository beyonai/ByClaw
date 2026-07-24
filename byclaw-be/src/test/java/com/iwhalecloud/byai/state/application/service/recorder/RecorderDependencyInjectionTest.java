package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RecorderDependencyInjectionTest {

    @Test
    void recorderServicesRequireTheManagedLlmServiceDependency() {
        assertThat(RecorderApplicationService.class.getConstructors())
            .singleElement()
            .satisfies(constructor -> assertThat(constructor.getParameterTypes()).contains(RecorderLlmService.class));
        assertThat(RecorderPipelineService.class.getConstructors())
            .singleElement()
            .satisfies(constructor -> assertThat(constructor.getParameterTypes()).contains(RecorderLlmService.class));
        assertThat(RecorderLlmService.class.getDeclaredConstructors())
            .singleElement()
            .satisfies(constructor -> assertThat(constructor.getParameterTypes()).containsExactly(
                com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService.class,
                com.iwhalecloud.byai.manager.domain.aimodel.service.AIService.class
            ));
    }
}
