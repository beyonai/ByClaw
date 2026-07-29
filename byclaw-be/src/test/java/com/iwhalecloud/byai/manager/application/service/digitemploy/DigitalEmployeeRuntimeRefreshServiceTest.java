package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DigitalEmployeeRuntimeRefreshServiceTest {

    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;
    private DigitalEmployeeRuntimeRefreshService service;

    @BeforeEach
    void setUp() {
        digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);
        digEmployeeChangeEventPublisher = mock(DigEmployeeChangeEventPublisher.class);
        service = new DigitalEmployeeRuntimeRefreshService();
        ReflectionTestUtils.setField(service, "digitalEmployeeApplicationService", digitalEmployeeApplicationService);
        ReflectionTestUtils.setField(service, "digEmployeeChangeEventPublisher", digEmployeeChangeEventPublisher);
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void scheduleSkillRuntimeRefreshAfterCommit_defersDeduplicatesAndPublishesAfterRedisSync() {
        when(digitalEmployeeApplicationService.synOpenClawWorkSpace(42L)).thenReturn(true);
        TransactionSynchronizationManager.initSynchronization();

        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));
        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));

        List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
        synchronizations.forEach(TransactionSynchronization::afterCommit);

        verify(digitalEmployeeApplicationService).synOpenClawWorkSpace(42L);
        verify(digEmployeeChangeEventPublisher).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");

        synchronizations.forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));
    }

    @Test
    void scheduleSkillRuntimeRefreshAfterCommit_doesNotPublishWhenRedisSyncFails() {
        when(digitalEmployeeApplicationService.synOpenClawWorkSpace(42L)).thenReturn(false);

        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));

        verify(digitalEmployeeApplicationService).synOpenClawWorkSpace(42L);
        verify(digEmployeeChangeEventPublisher, never()).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");
    }

    @Test
    void scheduleDigitalEmployeeUpdateRefreshAfterCommit_passesInputAndPublishesUpdatedEvent() {
        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        inputDto.setResourceId(42L);
        when(digitalEmployeeApplicationService.synOpenClawWorkSpace(42L, inputDto)).thenReturn(true);

        service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, inputDto);

        verify(digitalEmployeeApplicationService).synOpenClawWorkSpace(42L, inputDto);
        verify(digEmployeeChangeEventPublisher).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 42L, "manager-api");
    }

    @Test
    void scheduleDigitalEmployeeUpdateRefreshAfterCommit_preservesUpdatedEventWhenRedisSyncFails() {
        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        when(digitalEmployeeApplicationService.synOpenClawWorkSpace(42L, inputDto)).thenReturn(false);

        service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, inputDto);

        verify(digEmployeeChangeEventPublisher).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 42L, "manager-api");
    }

    @Test
    void scheduleSkillRuntimeRefreshAfterCommit_doesNothingWhenTransactionRollsBack() {
        TransactionSynchronizationManager.initSynchronization();

        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));
        List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
        synchronizations.forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

        verify(digitalEmployeeApplicationService, never()).synOpenClawWorkSpace(42L);
        verify(digEmployeeChangeEventPublisher, never()).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");
    }
}
