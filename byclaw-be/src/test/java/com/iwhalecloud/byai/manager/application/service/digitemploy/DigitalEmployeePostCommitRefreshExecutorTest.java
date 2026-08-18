package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import java.lang.reflect.Method;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

class DigitalEmployeePostCommitRefreshExecutorTest {

    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;
    private DigitalEmployeePostCommitRefreshExecutor executor;

    @BeforeEach
    void setUp() {
        digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);
        executor = new DigitalEmployeePostCommitRefreshExecutor(digitalEmployeeApplicationService);
    }

    @Test
    void refreshUsesRequiresNewTransactionAndRollsBackForException() throws Exception {
        Method method = DigitalEmployeePostCommitRefreshExecutor.class
            .getMethod("refresh", Long.class, DigitalEmployeeDTO.class);

        Transactional transactional = method.getAnnotation(Transactional.class);

        assertThat(transactional).isNotNull();
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
        assertThat(transactional.rollbackFor()).containsExactly(Exception.class);
    }

    @Test
    void refreshDelegatesToSkillAndManagerWorkspaceOverloads() {
        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        when(digitalEmployeeApplicationService.synOpenClawWorkSpace(42L)).thenReturn(true);
        when(digitalEmployeeApplicationService.synOpenClawWorkSpace(43L, inputDto)).thenReturn(false);

        assertThat(executor.refresh(42L, null)).isTrue();
        assertThat(executor.refresh(43L, inputDto)).isFalse();

        verify(digitalEmployeeApplicationService).synOpenClawWorkSpace(42L);
        verify(digitalEmployeeApplicationService).synOpenClawWorkSpace(43L, inputDto);
    }
}
