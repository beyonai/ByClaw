package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DigitalEmployeeRuntimeRefreshServiceTest {

    private DigitalEmployeePostCommitRefreshExecutor postCommitRefreshExecutor;
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;
    private DigitalEmployeeRuntimeRefreshService service;

    @BeforeEach
    void setUp() {
        postCommitRefreshExecutor = mock(DigitalEmployeePostCommitRefreshExecutor.class);
        digEmployeeChangeEventPublisher = mock(DigEmployeeChangeEventPublisher.class);
        service = new DigitalEmployeeRuntimeRefreshService();
        ReflectionTestUtils.setField(service, "postCommitRefreshExecutor", postCommitRefreshExecutor);
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
        when(postCommitRefreshExecutor.refresh(42L, null)).thenReturn(true);
        TransactionSynchronizationManager.initSynchronization();

        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));
        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));
        verify(postCommitRefreshExecutor, never()).refresh(42L, null);

        List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
        synchronizations.forEach(TransactionSynchronization::afterCommit);

        InOrder order = inOrder(postCommitRefreshExecutor, digEmployeeChangeEventPublisher);
        order.verify(postCommitRefreshExecutor).refresh(42L, null);
        order.verify(digEmployeeChangeEventPublisher).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");

        synchronizations.forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));
    }

    @Test
    void scheduleSkillRuntimeRefreshAfterCommit_doesNotPublishWhenRedisSyncFails() {
        when(postCommitRefreshExecutor.refresh(42L, null)).thenReturn(false);

        assertThatThrownBy(() -> service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L)))
            .isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class).hasMessageContaining("配置已保存");

        verify(postCommitRefreshExecutor, times(3)).refresh(42L, null);
        verify(digEmployeeChangeEventPublisher, never()).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");
    }

    @Test
    void scheduleDigitalEmployeeUpdateRefreshAfterCommit_passesInputAndPublishesUpdatedEvent() {
        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        inputDto.setResourceId(42L);
        when(postCommitRefreshExecutor.refresh(42L, inputDto)).thenReturn(true);

        service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, inputDto);

        verify(postCommitRefreshExecutor).refresh(42L, inputDto);
        verify(digEmployeeChangeEventPublisher).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 42L, "manager-api");
    }

    @Test
    void scheduleDigitalEmployeeUpdateRefreshAfterCommit_withoutInputDefersRefreshAndNotificationUntilCommit() {
        when(postCommitRefreshExecutor.refresh(42L, null)).thenReturn(true);
        TransactionSynchronizationManager.initSynchronization();
        try {
            // 卸载没有编辑 DTO，必须在关联事务提交后按数据库最新状态刷新。
            service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, null);
            verifyNoInteractions(postCommitRefreshExecutor, digEmployeeChangeEventPublisher);

            List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
            synchronizations.forEach(TransactionSynchronization::afterCommit);

            InOrder order = inOrder(postCommitRefreshExecutor, digEmployeeChangeEventPublisher);
            order.verify(postCommitRefreshExecutor).refresh(42L, null);
            order.verify(digEmployeeChangeEventPublisher).publishNowQuietly(
                DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 42L, "manager-api");
        } finally {
            TransactionSynchronizationManager.getSynchronizations()
                .forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));
        }
    }

    @Test
    void scheduleDigitalEmployeeUpdateRefreshAfterCommit_withoutInputDoesNotRefreshOrNotifyOnRollback() {
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, null);
        } finally {
            TransactionSynchronizationManager.getSynchronizations()
                .forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        }

        verifyNoInteractions(postCommitRefreshExecutor, digEmployeeChangeEventPublisher);
    }

    @Test
    void scheduleDigitalEmployeeUpdateRefreshAfterCommit_reportsFailureWithoutPublishingStaleSnapshot() {
        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        when(postCommitRefreshExecutor.refresh(42L, inputDto)).thenReturn(false);

        assertThatThrownBy(() -> service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, inputDto))
            .isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class).hasMessageContaining("请重试保存");

        verify(postCommitRefreshExecutor, times(3)).refresh(42L, inputDto);
        verifyNoInteractions(digEmployeeChangeEventPublisher);
    }

    @Test
    void scheduleSkillRuntimeRefreshAfterCommit_skipsEventWhenExecutorThrows() {
        doThrow(new IllegalStateException("boom")).when(postCommitRefreshExecutor).refresh(42L, null);

        assertThatThrownBy(() -> service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L)))
            .isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class).hasMessageContaining("配置已保存");

        verify(postCommitRefreshExecutor, times(3)).refresh(42L, null);
        verify(digEmployeeChangeEventPublisher, never()).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");
    }

    @Test
    void committedRefreshFailureRemainsVisibleInTheApiErrorResponse() {
        var failure = org.assertj.core.api.Assertions.catchThrowableOfType(
            () -> service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, null),
            com.iwhalecloud.byai.common.exception.BaseException.class);
        var handler = new com.iwhalecloud.byai.state.infrastructure.exception.GlobalExceptionHandler();
        handler.setMessageSource(new org.springframework.context.support.StaticMessageSource());
        org.assertj.core.api.Assertions.assertThat(handler.exception(null, failure).getBody().getMsg())
            .contains("配置已保存", "运行配置同步失败", "请重试保存");
    }

    @Test
    void transientFailureRetriesTheSameInputBeforePublishing() {
        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        when(postCommitRefreshExecutor.refresh(42L, inputDto)).thenReturn(false).thenThrow(new IllegalStateException("redis"))
            .thenReturn(true);
        service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, inputDto);
        InOrder order = inOrder(postCommitRefreshExecutor, digEmployeeChangeEventPublisher);
        order.verify(postCommitRefreshExecutor, times(3)).refresh(42L, inputDto);
        order.verify(digEmployeeChangeEventPublisher).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 42L, "manager-api");
    }

    @Test
    void oneFailedEmployeeDoesNotPreventOtherCommittedEmployeesFromRefreshing() {
        when(postCommitRefreshExecutor.refresh(43L, null)).thenReturn(true);
        TransactionSynchronizationManager.initSynchronization();
        service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(42L, null);
        service.scheduleDigitalEmployeeUpdateRefreshAfterCommit(43L, null);
        var synchronizations = TransactionSynchronizationManager.getSynchronizations();
        try {
            assertThatThrownBy(() -> synchronizations.forEach(TransactionSynchronization::afterCommit))
                .isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class);
            verify(postCommitRefreshExecutor, times(3)).refresh(42L, null);
            verify(postCommitRefreshExecutor).refresh(43L, null);
            verify(digEmployeeChangeEventPublisher).publishNowQuietly(
                DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 43L, "manager-api");
        } finally {
            synchronizations.forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));
        }
    }

    @Test
    void scheduleSkillRuntimeRefreshAfterCommit_doesNothingWhenTransactionRollsBack() {
        TransactionSynchronizationManager.initSynchronization();

        service.scheduleSkillRuntimeRefreshAfterCommit(List.of(42L));
        List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
        synchronizations.forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

        verify(postCommitRefreshExecutor, never()).refresh(42L, null);
        verify(digEmployeeChangeEventPublisher, never()).publishNowQuietly(
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, 42L, "skill-runtime-refresh");
    }
}
