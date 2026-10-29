package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EmployeeVersionSyncTest {
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final DigitalEmployeePublicationMapper locks = mock(DigitalEmployeePublicationMapper.class);
    private final SsResourceMapper resources = mock(SsResourceMapper.class);
    private final EmployeeVersionActivationMapper activations = mock(EmployeeVersionActivationMapper.class);
    private final EmployeeVersionStore store = mock(EmployeeVersionStore.class);
    private final DigitalEmployeePostCommitRefreshExecutor executor = mock(DigitalEmployeePostCommitRefreshExecutor.class);
    private final EmployeeVersionLock mutex = mock(EmployeeVersionLock.class);
    private final EmployeeVersionSync sync = new EmployeeVersionSync(manager, locks, resources, activations, store, executor, mutex);
    private SsResource resource;
    private EmployeeVersionActivation activation;
    private DigitalEmployeeDTO configuration;
    private SsResourceVersion version;

    @BeforeEach void setup() {
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
            new org.apache.ibatis.builder.MapperBuilderAssistant(new com.baomidou.mybatisplus.core.MybatisConfiguration(), "version-sync-test"), SsResource.class);
        when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
        resource = new SsResource(); resource.setResourceId(10L); resource.setComAcctId(1L);
        resource.setResourceRVerid(12L); resource.setPendingActivationId(100L);
        activation = new EmployeeVersionActivation(); activation.setActivationId(100L);
        activation.setStatus("SYNC_PENDING"); activation.setRetryCount(0);
        configuration = new DigitalEmployeeDTO(); configuration.setResourceId(10L); configuration.setAgentType("001");
        configuration.setResourceName("当前配置");
        version = new SsResourceVersion(); version.setResourceVersionId(12L);
        version.setExtInfo(EmployeeVersionSnapshot.encode(configuration));
        when(resources.selectById(10L)).thenReturn(resource);
        when(locks.lockResource(10L, 1L)).thenReturn(resource);
        when(store.pending(resource)).thenReturn(activation);
        when(store.requireVersion(resource, 12L)).thenReturn(version);
        when(store.current(10L)).thenReturn(configuration);
    }

    @Test void successfulSyncUsesIndependentTransactionAndClearsOnlyItsPendingOperation() {
        when(executor.refresh(eq(10L), any())).thenReturn(true);
        sync.refresh(10L);
        assertEquals("READY", activation.getStatus()); assertEquals(1, activation.getRetryCount());
        assertNotNull(activation.getCompletedAt()); assertNull(activation.getErrorMessage());
        verify(manager).getTransaction(argThat(def -> def.getPropagationBehavior() == TransactionDefinition.PROPAGATION_REQUIRES_NEW));
        var order = inOrder(mutex, locks, executor, activations, resources, manager);
        order.verify(mutex).acquire(1L, 10L);
        order.verify(locks).lockResource(10L, 1L);
        order.verify(executor).refresh(eq(10L), argThat(dto -> "当前配置".equals(dto.getResourceName())));
        order.verify(activations).updateById(activation);
        order.verify(resources).update(isNull(), any());
        order.verify(manager).commit(any());
    }

    @Test void failedSyncPersistsSafeErrorAndRetryCanCompleteCurrentVersion() {
        when(executor.refresh(eq(10L), any())).thenThrow(new IllegalStateException("secret-runtime-detail"));
        sync.refresh(10L);
        assertEquals("SYNC_FAILED", activation.getStatus());
        assertEquals(1, activation.getRetryCount()); assertTrue(activation.getErrorMessage().contains("100"));
        assertFalse(activation.getErrorMessage().contains("secret-runtime-detail"));
        verify(manager).rollback(any()); verify(manager).commit(any());
        verify(resources, never()).update(isNull(), any());
        when(executor.refresh(eq(10L), any())).thenReturn(true);
        sync.refresh(10L);
        assertEquals("READY", activation.getStatus()); assertEquals(2, activation.getRetryCount());
        assertNull(activation.getErrorMessage()); verify(resources).update(isNull(), any());
    }

    @Test void supersededCallbackCannotRefreshOrClearNewerVersion() {
        SsResource newer = new SsResource(); newer.setResourceId(10L); newer.setComAcctId(1L); newer.setPendingActivationId(101L);
        when(locks.lockResource(10L, 1L)).thenReturn(newer);
        sync.refresh(10L);
        verifyNoInteractions(store, executor, activations);
        verify(resources, never()).update(isNull(), any());
    }

    @Test void failureRecordingDoesNotOverwriteAConcurrentNewActivation() {
        SsResource newer = new SsResource(); newer.setPendingActivationId(101L);
        when(locks.lockResource(10L, 1L)).thenReturn(resource, newer);
        when(executor.refresh(eq(10L), any())).thenReturn(false);
        sync.refresh(10L);
        verify(activations, never()).updateById(any(EmployeeVersionActivation.class));
        verify(resources, never()).update(isNull(), any());
    }

    @Test void groupVersionAlreadyUsesDatabaseSnapshotWithoutOrdinaryAgentWorkspace() {
        configuration.setAgentType("017"); version.setExtInfo(EmployeeVersionSnapshot.encode(configuration));
        sync.refresh(10L);
        assertEquals("READY", activation.getStatus()); verifyNoInteractions(executor);
        verify(resources).update(isNull(), any());
    }
}
