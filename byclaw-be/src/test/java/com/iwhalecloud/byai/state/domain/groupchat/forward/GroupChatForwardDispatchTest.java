package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ExecutorService;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class GroupChatForwardDispatchTest {
    private GroupChatForwardServiceTest fixture;
    @org.junit.jupiter.api.AfterEach void closeRedis() throws Exception { if (fixture != null) fixture.closeRedis(); }
    @Test void dispatchWaitsForCommitAndRollbackNeverDispatches() throws Exception {
        fixture=new GroupChatForwardServiceTest();fixture.setup();
        var recovery=mock(GroupChatForwardRecoveryService.class);
        @SuppressWarnings("unchecked") var provider=(ObjectProvider<GroupChatForwardRecoveryService>)mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(recovery);
        var service=new GroupChatForwardService(fixture.store,null,null,mock(ForwardPlatformPolicy.class),null,null,null,null,null);
        ReflectionTestUtils.setField(service,"recovery",provider);
        var tx=new TransactionTemplate(new DataSourceTransactionManager(fixture.db.getDataSource()));
        tx.execute(status->{service.create(fixture.actor,10,fixture.input("rollback"));verifyNoInteractions(recovery);status.setRollbackOnly();return null;});
        verifyNoInteractions(recovery);
        var operation=tx.execute(status->{var result=service.create(fixture.actor,10,fixture.input("commit"));verifyNoInteractions(recovery);return result;});
        verify(recovery).submitRequest(new ForwardOperationLocator(1,operation.requestId(),ForwardBackend.LEGACY));
        assertThat(fixture.db.queryForObject("SELECT count(*) FROM byai.byai_group_chat_forward_request",Integer.class)).isEqualTo(1);
    }

    @Test void oneRequestFreezesOnceAndQueuesOnlyOneJobForAllTargets() {
        var contexts=mock(GroupChatForwardExecutionContextService.class);
        var owning=mock(GroupChatForwardStore.class);
        var forwards=mock(GroupChatForwardService.class);
        var locator=new ForwardOperationLocator(1,100,ForwardBackend.LEGACY);
        when(contexts.store(locator)).thenReturn(owning);
        when(owning.discoverRequestWork(locator)).thenReturn(new WorkPage(List.of(new WorkCandidate(locator,200,false),new WorkCandidate(locator,201,false)),null,false));
        var recovery=spy(new GroupChatForwardRecoveryService(null,mock(LegacyForwardMaintenanceStore.class),null,contexts,forwards,null,new GroupChatForwardProperties()));
        var executor=mock(ExecutorService.class);var tasks=new ArrayDeque<Runnable>();
        doAnswer(invocation->{tasks.add(invocation.getArgument(0));return null;}).when(executor).execute(any());
        ReflectionTestUtils.setField(recovery,"workers",executor);
        doNothing().when(recovery).process(any(),any(),any());
        try {
            assertThat(recovery.submitRequest(locator)).isTrue();
            assertThat(recovery.submitRequest(locator)).isTrue();
            assertThat(tasks).hasSize(1);
            tasks.removeFirst().run();
            verify(forwards).resolveRequest(eq(locator),any());
            verify(recovery).process(any(),eq(new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Candidate(locator,200,true)),any());
            verify(recovery).process(any(),eq(new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Candidate(locator,201,true)),any());
        } finally { recovery.close(); }
    }

    @Test void saturatedTenantWorkersConsumeQueuedRequestWithoutRecoveryTick() throws Exception {
        var contexts=mock(GroupChatForwardExecutionContextService.class);
        var owning=mock(GroupChatForwardStore.class);
        when(contexts.store(any())).thenReturn(owning);
        var entered=new java.util.concurrent.CountDownLatch(2);
        var release=new java.util.concurrent.CountDownLatch(1);
        var queuedRan=new java.util.concurrent.CountDownLatch(1);
        when(owning.discoverRequestWork(any())).thenAnswer(inv->{
            ForwardOperationLocator locator=inv.getArgument(0);
            if(locator.requestId()<3) { entered.countDown();assertThat(release.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue(); }
            else queuedRan.countDown();
            return new WorkPage(List.of(),null,false);
        });
        var recovery=new GroupChatForwardRecoveryService(null,null,null,contexts,null,null,new GroupChatForwardProperties());
        try {
            assertThat(recovery.submitRequest(new ForwardOperationLocator(10,1,ForwardBackend.TENANT))).isTrue();
            assertThat(recovery.submitRequest(new ForwardOperationLocator(10,2,ForwardBackend.TENANT))).isTrue();
            assertThat(entered.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(recovery.submitRequest(new ForwardOperationLocator(10,3,ForwardBackend.TENANT))).isTrue();
            release.countDown();
            assertThat(queuedRan.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        } finally { release.countDown();recovery.close(); }
    }

    @Test void completedTextDeliveryDoesNotWaitForCopyWorkers() throws Exception {
        var contexts=mock(GroupChatForwardExecutionContextService.class);var owning=mock(GroupChatForwardStore.class);
        when(contexts.store(any())).thenReturn(owning);
        var entered=new java.util.concurrent.CountDownLatch(2);var release=new java.util.concurrent.CountDownLatch(1);
        var delivered=new java.util.concurrent.CountDownLatch(1);
        var completed=new ForwardOperationLocator(10,3,ForwardBackend.TENANT);
        when(owning.discoverRequestWork(any())).thenAnswer(inv->{
            ForwardOperationLocator locator=inv.getArgument(0);
            if(locator.equals(completed))return new WorkPage(List.of(new WorkCandidate(locator,300,true,true)),null,false);
            entered.countDown();release.await(5,java.util.concurrent.TimeUnit.SECONDS);return new WorkPage(List.of(),null,false);
        });
        var recovery=spy(new GroupChatForwardRecoveryService(null,null,mock(TenantForwardMaintenanceStore.class),contexts,null,null,new GroupChatForwardProperties()));
        doAnswer(inv->{delivered.countDown();return null;}).when(recovery).process(any(),any(),eq(com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Category.DELIVERY));
        try {
            recovery.submitRequest(new ForwardOperationLocator(10,1,ForwardBackend.TENANT));
            recovery.submitRequest(new ForwardOperationLocator(10,2,ForwardBackend.TENANT));
            assertThat(entered.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(recovery.submitDeliveryRequest(completed)).isTrue();
            assertThat(delivered.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        } finally {release.countDown();recovery.close();}
    }
    @Test void admissionIsBoundedAndRejectedRequestCanBeResubmitted() {
        var recovery=new GroupChatForwardRecoveryService(null,null,null,null,null,null,new GroupChatForwardProperties());
        var executor=mock(ExecutorService.class);var tasks=new ArrayDeque<Runnable>();
        doAnswer(inv->{tasks.add(inv.getArgument(0));return null;}).when(executor).execute(any());
        ReflectionTestUtils.setField(recovery,"tenantWorkers",executor);
        try {
            for(int i=1;i<=66;i++)assertThat(recovery.submitRequest(new ForwardOperationLocator(10,i,ForwardBackend.TENANT))).isTrue();
            var rejected=new ForwardOperationLocator(10,67,ForwardBackend.TENANT);
            assertThat(recovery.submitRequest(rejected)).isFalse();
            assertThat(tasks).hasSize(66);
            // The failed worker still releases admission; durable work remains discoverable.
            tasks.removeFirst().run();
            assertThat(recovery.submitRequest(rejected)).isTrue();
        } finally {recovery.close();}
    }

    @Test void saturatedCopyAdmissionDoesNotDisableDeliveryRecovery() {
        var directory=mock(ForwardRecoveryDirectory.class);var legacy=mock(LegacyForwardMaintenanceStore.class);var tenant=mock(TenantForwardMaintenanceStore.class);
        when(directory.legacyEnterprises(anyLong(),eq(1))).thenReturn(List.of(1L));
        when(directory.readyTenants(anyLong(),eq(4))).thenReturn(List.of(10L));
        var empty=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Page(List.of(),null);
        when(legacy.scan(anyLong(),any(),any(),anyInt())).thenReturn(empty);when(tenant.scan(anyLong(),any(),any(),anyInt())).thenReturn(empty);
        var recovery=new GroupChatForwardRecoveryService(directory,legacy,tenant,null,null,null,new GroupChatForwardProperties());
        var executor=mock(ExecutorService.class);doAnswer(inv->{((Runnable)inv.getArgument(0)).run();return null;}).when(executor).execute(any());
        ReflectionTestUtils.setField(recovery,"tenantDiscovery",executor);
        ((java.util.concurrent.Semaphore)ReflectionTestUtils.getField(recovery,"capacity")).drainPermits();
        ((java.util.concurrent.Semaphore)ReflectionTestUtils.getField(recovery,"tenantCapacity")).drainPermits();
        try {
            recovery.recover(Instant.EPOCH,20);recovery.recover(Instant.EPOCH,20);
            verify(legacy,atLeastOnce()).scan(eq(1L),eq(com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Category.DELIVERY),any(),eq(20));
            verify(tenant,atLeastOnce()).scan(eq(10L),eq(com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Category.DELIVERY),any(),eq(20));
        } finally {recovery.close();}
    }
    @Test void cursorWrapScansImmediatelyWhileNodeDiscoveryStaysOffSchedulerThread() {
        var directory=mock(ForwardRecoveryDirectory.class);
        var legacy=mock(LegacyForwardMaintenanceStore.class);
        var tenant=mock(TenantForwardMaintenanceStore.class);
        when(directory.legacyEnterprises(1,1)).thenReturn(List.of());
        when(directory.legacyEnterprises(0,1)).thenReturn(List.of(1L));
        when(directory.readyTenants(0,4)).thenReturn(List.of(10L));
        when(legacy.scan(anyLong(),any(),any(),anyInt())).thenReturn(new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Page(List.of(),null));
        when(tenant.scan(anyLong(),any(),any(),anyInt())).thenThrow(new IllegalStateException("FORWARD_WORK_UNAVAILABLE"));
        var recovery=new GroupChatForwardRecoveryService(directory,legacy,tenant,null,null,null,new GroupChatForwardProperties());
        var discovery=mock(ExecutorService.class);var tasks=new ArrayDeque<Runnable>();
        doAnswer(invocation->{tasks.add(invocation.getArgument(0));return null;}).when(discovery).execute(any());
        ReflectionTestUtils.setField(recovery,"tenantDiscovery",discovery);
        ReflectionTestUtils.setField(recovery,"legacyCursor",1L);
        try {
            recovery.recover(Instant.EPOCH,20);
            recovery.recover(Instant.EPOCH,20);
            verify(legacy,times(2)).scan(eq(1L),any(),any(),eq(20));
            verifyNoInteractions(tenant);
            assertThat(tasks).hasSize(1);
            tasks.removeFirst().run();
            verify(tenant).scan(eq(10L),any(),any(),eq(20));
        } finally { recovery.close(); }
    }
}
