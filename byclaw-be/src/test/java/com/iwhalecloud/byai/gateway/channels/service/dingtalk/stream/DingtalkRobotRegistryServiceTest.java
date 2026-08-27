package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.open.app.api.OpenDingTalkClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.util.concurrent.MoreExecutors;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle.DingtalkConnectionLockService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener.DingtalkBotListener;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.anyString;

class DingtalkRobotRegistryServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void synchronousStartFailureIsRetriedAutomatically() throws Exception {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        properties.getLifecycle().setStartRetryDelaysMillis(java.util.List.of(1L));
        properties.getLifecycle().setMaxStartAttempts(2);
        DingtalkBotListener botListener = mock(DingtalkBotListener.class);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        DingtalkRobotConfigService configService = new DingtalkRobotConfigService(objectMapper);
        DingtalkTokenService tokenService = mock(DingtalkTokenService.class);
        DingtalkConnectionLockService lockService = ownedLockService("owner-1");
        ResourceExtDigEmployeeDto digitalEmployee = buildDigitalEmployee();
        when(employeeService.findExtDigEmployeeById(1001L)).thenReturn(digitalEmployee);

        AtomicInteger startAttempts = new AtomicInteger();
        DingtalkRobotRegistryService service = new DingtalkRobotRegistryService(
                properties,
                botListener,
                employeeService,
                configService,
                tokenService,
                lockService,
                robotConfig -> new OpenDingTalkClient() {
                    @Override
                    public void start() throws Exception {
                        if (startAttempts.incrementAndGet() == 1) {
                            throw new IllegalStateException("stream start failed");
                        }
                    }

                    @Override
                    public void stop() {
                    }
                },
                MoreExecutors.newDirectExecutorService()
        );

        service.forceRegisterRobotClientsForResource(1001L);

        awaitValue(startAttempts, 2);
        assertThat(startAttempts.get()).isEqualTo(2);
        service.shutdownAll();
    }

    @Test
    void completedOldStartCannotReactivateAnUnregisteredRobot() throws Exception {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        when(employeeService.findExtDigEmployeeById(1001L)).thenReturn(buildDigitalEmployee());
        CountDownLatch startEntered = new CountDownLatch(1);
        CountDownLatch allowStartToReturn = new CountDownLatch(1);
        AtomicInteger stops = new AtomicInteger();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        DingtalkRobotRegistryService service = new DingtalkRobotRegistryService(
                properties,
                mock(DingtalkBotListener.class),
                employeeService,
                new DingtalkRobotConfigService(objectMapper),
                mock(DingtalkTokenService.class),
                ownedLockService("owner-stale"),
                ignored -> new OpenDingTalkClient() {
                    @Override
                    public void start() throws Exception {
                        startEntered.countDown();
                        allowStartToReturn.await(2, TimeUnit.SECONDS);
                    }

                    @Override
                    public void stop() {
                        stops.incrementAndGet();
                    }
                },
                executor
        );

        service.registerRobotClientsForResource(1001L);
        assertThat(startEntered.await(2, TimeUnit.SECONDS)).isTrue();
        CompletableFuture<Void> unregister = CompletableFuture.runAsync(
                () -> service.unregisterRobotClientsForResource(1001L));
        Thread.sleep(50L);
        assertThat(unregister).isNotDone();
        allowStartToReturn.countDown();
        unregister.get(2, TimeUnit.SECONDS);
        executor.shutdown();
        assertThat(executor.awaitTermination(2, TimeUnit.SECONDS)).isTrue();

        assertThat(service.isRobotClientActive("robot-001")).isFalse();
        assertThat(stops).hasValue(1);
        service.shutdownAll();
    }

    @Test
    void twoRegistryInstancesStartOnlyOneClientForTheSameRobotCode() {
        AtomicReference<String> sharedOwner = new AtomicReference<>();
        AtomicInteger starts = new AtomicInteger();
        DingtalkRobotRegistryService first = registryWithSharedLease("owner-a", sharedOwner, starts);
        DingtalkRobotRegistryService second = registryWithSharedLease("owner-b", sharedOwner, starts);

        first.registerRobotClientsForResource(1001L);
        second.registerRobotClientsForResource(1001L);

        assertThat(starts).hasValue(1);
    }

    @Test
    void metadataRefreshDoesNotRestartTheStreamClient() {
        RegistryFixture fixture = new RegistryFixture();
        fixture.employee = buildDigitalEmployee("client-001", "secret-001", "Agent before", "card-before");
        when(fixture.employeeService.findExtDigEmployeeById(1001L)).thenAnswer(ignored -> fixture.employee);

        fixture.service.registerRobotClientsForResource(1001L);
        fixture.employee = buildDigitalEmployee("client-001", "secret-001", "Agent after", "card-after");
        fixture.service.refreshRobotClientsForResource(1001L);

        assertThat(fixture.starts).hasValue(1);
        assertThat(fixture.stops).hasValue(0);
        assertThat(fixture.configService.getRobotConfig("robot-001").getResourceName()).isEqualTo("Agent after");
        assertThat(fixture.configService.getRobotConfig("robot-001").getCardTemplateId()).isEqualTo("card-after");
    }

    @Test
    void credentialRefreshStopsOnceAndCreatesANewClient() {
        RegistryFixture fixture = new RegistryFixture();
        fixture.employee = buildDigitalEmployee("client-001", "secret-001", "Agent", "card");
        when(fixture.employeeService.findExtDigEmployeeById(1001L)).thenAnswer(ignored -> fixture.employee);

        fixture.service.registerRobotClientsForResource(1001L);
        fixture.employee = buildDigitalEmployee("client-002", "secret-002", "Agent", "card");
        fixture.service.refreshRobotClientsForResource(1001L);

        assertThat(fixture.starts).hasValue(2);
        assertThat(fixture.stops).hasValue(1);
    }

    @Test
    void stopFailurePreventsAReplacementRuntimeInTheSameJvm() {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        AtomicReference<ResourceExtDigEmployeeDto> employee = new AtomicReference<>(
                buildDigitalEmployee("client-001", "secret-001", "Agent", "card"));
        when(employeeService.findExtDigEmployeeById(1001L)).thenAnswer(ignored -> employee.get());
        AtomicInteger starts = new AtomicInteger();
        DingtalkConnectionLockService lockService = ownedLockService("stop-failed-owner");
        DingtalkRobotRegistryService service = new DingtalkRobotRegistryService(
                properties,
                mock(DingtalkBotListener.class),
                employeeService,
                new DingtalkRobotConfigService(objectMapper),
                mock(DingtalkTokenService.class),
                lockService,
                ignored -> new OpenDingTalkClient() {
                    @Override
                    public void start() {
                        starts.incrementAndGet();
                    }

                    @Override
                    public void stop() {
                        throw new IllegalStateException("stop failed");
                    }
                },
                MoreExecutors.newDirectExecutorService()
        );

        service.registerRobotClientsForResource(1001L);
        employee.set(buildDigitalEmployee("client-002", "secret-002", "Agent", "card"));
        service.refreshRobotClientsForResource(1001L);
        service.forceRegisterRobotClientsForResource(1001L);

        assertThat(starts).hasValue(1);
        service.shutdownAll();
        verify(lockService, never()).release("robot-001", "stop-failed-owner");
    }

    @Test
    void registrationChangesRuntimeOnlyAfterTransactionCommit() {
        RegistryFixture fixture = new RegistryFixture();
        fixture.employee = buildDigitalEmployee();
        when(fixture.employeeService.findExtDigEmployeeById(1001L)).thenAnswer(ignored -> fixture.employee);
        TransactionSynchronizationManager.initSynchronization();
        try {
            fixture.service.registerRobotClientsForResource(1001L);

            assertThat(fixture.starts).hasValue(0);
            TransactionSynchronizationManager.getSynchronizations()
                    .forEach(TransactionSynchronization::afterCommit);
            assertThat(fixture.starts).hasValue(1);
        } finally {
            TransactionSynchronizationManager.getSynchronizations()
                    .forEach(sync -> sync.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void transactionRollbackDoesNotChangeRuntime() {
        RegistryFixture fixture = new RegistryFixture();
        fixture.employee = buildDigitalEmployee();
        when(fixture.employeeService.findExtDigEmployeeById(1001L)).thenAnswer(ignored -> fixture.employee);
        TransactionSynchronizationManager.initSynchronization();
        try {
            fixture.service.registerRobotClientsForResource(1001L);

            TransactionSynchronizationManager.getSynchronizations()
                    .forEach(sync -> sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
            assertThat(fixture.starts).hasValue(0);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void leaseRenewalFailureStopsTheLocalRuntime() {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        when(employeeService.findExtDigEmployeeById(1001L)).thenReturn(buildDigitalEmployee());
        DingtalkConnectionLockService lockService = mock(DingtalkConnectionLockService.class);
        when(lockService.newOwnerToken()).thenReturn("renew-owner");
        when(lockService.acquire(anyString(), anyString())).thenReturn(true);
        when(lockService.renew(anyString(), anyString())).thenReturn(false);
        when(lockService.release(anyString(), anyString())).thenReturn(true);
        AtomicInteger stops = new AtomicInteger();
        DingtalkRobotRegistryService service = new DingtalkRobotRegistryService(
                properties,
                mock(DingtalkBotListener.class),
                employeeService,
                new DingtalkRobotConfigService(objectMapper),
                mock(DingtalkTokenService.class),
                lockService,
                ignored -> new OpenDingTalkClient() {
                    @Override
                    public void start() {
                    }

                    @Override
                    public void stop() {
                        stops.incrementAndGet();
                    }
                },
                MoreExecutors.newDirectExecutorService()
        );

        service.registerRobotClientsForResource(1001L);
        service.renewConnectionLeases();

        assertThat(stops).hasValue(1);
        assertThat(service.isRobotClientActive("robot-001")).isFalse();
        verify(lockService).release("robot-001", "renew-owner");
        service.shutdownAll();
    }

    @Test
    void leaseRenewalExceptionAlsoFailsClosed() {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        when(employeeService.findExtDigEmployeeById(1001L)).thenReturn(buildDigitalEmployee());
        DingtalkConnectionLockService lockService = mock(DingtalkConnectionLockService.class);
        when(lockService.newOwnerToken()).thenReturn("renew-error-owner");
        when(lockService.acquire(anyString(), anyString())).thenReturn(true);
        when(lockService.renew(anyString(), anyString())).thenThrow(new IllegalStateException("redis unavailable"));
        when(lockService.release(anyString(), anyString())).thenReturn(true);
        AtomicInteger stops = new AtomicInteger();
        DingtalkRobotRegistryService service = new DingtalkRobotRegistryService(
                properties,
                mock(DingtalkBotListener.class),
                employeeService,
                new DingtalkRobotConfigService(objectMapper),
                mock(DingtalkTokenService.class),
                lockService,
                ignored -> new OpenDingTalkClient() {
                    @Override
                    public void start() {
                    }

                    @Override
                    public void stop() {
                        stops.incrementAndGet();
                    }
                },
                MoreExecutors.newDirectExecutorService()
        );

        service.registerRobotClientsForResource(1001L);
        service.renewConnectionLeases();

        assertThat(stops).hasValue(1);
        service.shutdownAll();
    }

    @Test
    void reconciliationStopsResourcesThatAreNoLongerOnline() {
        RegistryFixture fixture = new RegistryFixture();
        fixture.employee = buildDigitalEmployee();
        when(fixture.employeeService.findExtDigEmployeeById(1001L)).thenReturn(fixture.employee);
        when(fixture.employeeService.findOnlineDigitalEmployees("DingTalk"))
                .thenReturn(java.util.List.of(fixture.employee), java.util.List.of());

        fixture.service.reconcileRobotClients();
        fixture.service.reconcileRobotClients();

        assertThat(fixture.starts).hasValue(1);
        assertThat(fixture.stops).hasValue(1);
        assertThat(fixture.configService.getRobotConfigsByResourceId(1001L)).isEmpty();
        fixture.service.shutdownAll();
    }

    @Test
    void reconciliationPreservesLastAcceptedRuntimeWhenCommittedConfigIsMalformed() {
        RegistryFixture fixture = new RegistryFixture();
        fixture.employee = buildDigitalEmployee();
        when(fixture.employeeService.findExtDigEmployeeById(1001L)).thenAnswer(ignored -> fixture.employee);
        fixture.service.registerRobotClientsForResource(1001L);
        fixture.employee.getSsResExtDigEmployee().setMachineChannel("{");
        when(fixture.employeeService.findOnlineDigitalEmployees("DingTalk"))
                .thenAnswer(ignored -> java.util.List.of(fixture.employee));

        fixture.service.reconcileRobotClients();

        assertThat(fixture.starts).hasValue(1);
        assertThat(fixture.stops).hasValue(0);
        assertThat(fixture.configService.getRobotConfig("robot-001").getClientId()).isEqualTo("client-001");
        fixture.service.shutdownAll();
    }

    private ResourceExtDigEmployeeDto buildDigitalEmployee() {
        return buildDigitalEmployee("client-001", "secret-001", "DingTalk Agent", "card-001.schema");
    }

    private ResourceExtDigEmployeeDto buildDigitalEmployee(
            String clientId, String clientSecret, String resourceName, String cardTemplateId) {
        ResourceExtDigEmployeeDto digitalEmployee = new ResourceExtDigEmployeeDto();
        digitalEmployee.setResourceId(1001L);
        digitalEmployee.setResourceName(resourceName);

        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setMachineChannel("""
                [{
                  "channel": "DingTalk",
                  "robotCode": "robot-001",
                  "clientId": "%s",
                  "clientSecret": "%s",
                  "appId": "app-001",
                  "AICardId": "%s"
                }]
                """.formatted(clientId, clientSecret, cardTemplateId));
        digitalEmployee.setSsResExtDigEmployee(ext);
        return digitalEmployee;
    }

    private final class RegistryFixture {
        private final DingtalkStreamProperties properties = new DingtalkStreamProperties();
        private final DingtalkBotListener botListener = mock(DingtalkBotListener.class);
        private final SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        private final DingtalkRobotConfigService configService = new DingtalkRobotConfigService(objectMapper);
        private final DingtalkTokenService tokenService = mock(DingtalkTokenService.class);
        private final DingtalkConnectionLockService lockService = ownedLockService("fixture-owner");
        private final AtomicInteger starts = new AtomicInteger();
        private final AtomicInteger stops = new AtomicInteger();
        private ResourceExtDigEmployeeDto employee;
        private final DingtalkRobotRegistryService service;

        private RegistryFixture() {
            properties.setEnabled(true);
            service = new DingtalkRobotRegistryService(
                    properties,
                    botListener,
                    employeeService,
                    configService,
                    tokenService,
                    lockService,
                    ignored -> new OpenDingTalkClient() {
                        @Override
                        public void start() {
                            starts.incrementAndGet();
                        }

                        @Override
                        public void stop() {
                            stops.incrementAndGet();
                        }
                    },
                    MoreExecutors.newDirectExecutorService()
            );
        }
    }

    private DingtalkRobotRegistryService registryWithSharedLease(
            String ownerToken, AtomicReference<String> sharedOwner, AtomicInteger starts) {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        when(employeeService.findExtDigEmployeeById(1001L)).thenReturn(buildDigitalEmployee());
        DingtalkConnectionLockService lockService = mock(DingtalkConnectionLockService.class);
        when(lockService.newOwnerToken()).thenReturn(ownerToken);
        when(lockService.acquire(anyString(), anyString()))
                .thenAnswer(invocation -> sharedOwner.compareAndSet(null, invocation.getArgument(1)));
        when(lockService.release(anyString(), anyString()))
                .thenAnswer(invocation -> sharedOwner.compareAndSet(invocation.getArgument(1), null));

        return new DingtalkRobotRegistryService(
                properties,
                mock(DingtalkBotListener.class),
                employeeService,
                new DingtalkRobotConfigService(objectMapper),
                mock(DingtalkTokenService.class),
                lockService,
                ignored -> new OpenDingTalkClient() {
                    @Override
                    public void start() {
                        starts.incrementAndGet();
                    }

                    @Override
                    public void stop() {
                    }
                },
                MoreExecutors.newDirectExecutorService()
        );
    }

    private DingtalkConnectionLockService ownedLockService(String ownerToken) {
        DingtalkConnectionLockService lockService = mock(DingtalkConnectionLockService.class);
        when(lockService.newOwnerToken()).thenReturn(ownerToken);
        when(lockService.acquire(anyString(), anyString())).thenReturn(true);
        when(lockService.renew(anyString(), anyString())).thenReturn(true);
        when(lockService.release(anyString(), anyString())).thenReturn(true);
        return lockService;
    }

    private void awaitValue(AtomicInteger value, int expected) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (value.get() != expected && System.nanoTime() < deadline) {
            Thread.sleep(10L);
        }
    }
}
