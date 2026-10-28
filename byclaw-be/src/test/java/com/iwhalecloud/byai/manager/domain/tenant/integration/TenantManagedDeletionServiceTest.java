package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantManagedDeletionServiceTest {
    JdbcTemplate jdbc;
    TenantCommandStore store;
    TenantManagedDeletionService service;
    TenantAdminTenantMapper tenants;
    TenantSandboxService sandboxes;
    TenantExecutionPolicyService policies;
    HookPublisher hooks;

    @BeforeEach void setup() {
        var fixture = new TenantCommandStoreTest(); fixture.setup();
        jdbc = fixture.jdbc; store = fixture.store;
        jdbc.execute("CREATE TABLE byai.tenant_config(id bigint,enterprise_id bigint,params_code varchar(100),params_value text,params_version bigint default 1)");
        jdbc.execute("CREATE TABLE byai.tenant_policy_cursor(enterprise_id bigint,desired_revision bigint,generation varchar(20) default '1')");
        jdbc.execute("CREATE TABLE byai.tenant_execution_policy(enterprise_id bigint,revision bigint,payload text)");
        jdbc.execute("CREATE TABLE byai.ss_sandbox_record(enterprise_id bigint,owner_scope varchar(20),sandbox_type varchar(40),status varchar(20),sandbox_id varchar(200))");
        jdbc.update("UPDATE byai.internal_command SET status='SUCCEEDED',stage='READY' WHERE id=1");
        jdbc.update("INSERT INTO byai.tenant_runtime_operation(enterprise_id,state) VALUES(2,'IDLE')");
        jdbc.update("INSERT INTO byai.tenant_config(id,enterprise_id,params_code,params_value) VALUES(1,2,'PROVISION_STATE','{\"status\":\"READY\"}'),(2,2,'INTEGRATION_SOURCE_SYSTEM','hacu'),(3,2,'COMMERCIAL_MANAGED','true'),(4,2,'DB_PASSWORD','encrypted-test'),(5,2,'PACKAGE_CONTENT_SNAPSHOT','{\"memberLimit\":2}')");
        jdbc.update("INSERT INTO byai.tenant_policy_cursor(enterprise_id,desired_revision) VALUES(2,1)");
        jdbc.update("INSERT INTO byai.tenant_execution_policy VALUES(2,1,'{\"revision\":\"1\",\"accessMode\":\"PREPARED\",\"limits\":{\"memberLimit\":2,\"groupLimit\":3,\"groupMemberLimit\":4,\"storageBytes\":\"1024\",\"agentLimit\":5,\"parallelTaskLimit\":1}}')");
        tenants = mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(anyLong(),anyString())).thenAnswer(c -> {
            var values=jdbc.queryForList("SELECT params_value FROM byai.tenant_config WHERE enterprise_id=? AND params_code=?",String.class,c.<Object>getArgument(0),c.<Object>getArgument(1));
            return values.isEmpty()?null:values.getFirst();
        });
        when(tenants.updateConfig(anyLong(),anyString(),anyString())).thenAnswer(c -> jdbc.update(
            "UPDATE byai.tenant_config SET params_value=? WHERE enterprise_id=? AND params_code=?",c.<Object>getArgument(2),c.<Object>getArgument(0),c.<Object>getArgument(1)));
        doAnswer(c -> jdbc.update("DELETE FROM byai.tenant_config WHERE enterprise_id=? AND params_code=?",c.<Object>getArgument(0),c.<Object>getArgument(1)))
            .when(tenants).deleteConfig(anyLong(),anyString());
        doAnswer(c -> jdbc.update("INSERT INTO byai.tenant_config(id,enterprise_id,params_code,params_value) VALUES(?,?,?,?)",c.<Object>getArgument(0),c.<Object>getArgument(1),c.<Object>getArgument(2),c.<Object>getArgument(3)))
            .when(tenants).insertConfig(anyLong(),anyLong(),anyString(),anyString());
        var ids=mock(SequenceService.class);var next=new AtomicLong(10);when(ids.nextVal()).thenAnswer(c -> next.getAndIncrement());
        sandboxes=mock(TenantSandboxService.class);policies=spy(new TenantExecutionPolicyService(jdbc,new ObjectMapper(),false,""));hooks=mock(HookPublisher.class);
        service=new TenantManagedDeletionService(store,jdbc,fixture.tx.getTransactionManager(),tenants,sandboxes,policies,
            ids,new ObjectMapper(),hooks,mock(StringRedisTemplate.class));
    }
    String state() { return tenants.selectConfig(2,"PROVISION_STATE"); }

    @Test void repeatedAdministratorRequestsShareOneDeletionAndPreserveSuccessfulProvisionHistory() {
        assertEquals("ACCEPTED",service.request(2,"tenant",10001));
        assertEquals("ACCEPTED",service.request(2,"tenant",10001));
        assertEquals("SUCCEEDED",store.find(1).status());assertEquals("DELETE",store.find(10).type());
        assertTrue(store.snapshot(10).contains("10001"));
        assertTrue(state().contains("DELETING"));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM byai.internal_command",Integer.class));
        verify(policies,times(1)).update(eq(2L),eq(1L),argThat(p -> "SUSPENDED".equals(p.path("accessMode").asText())));
        assertEquals("SUSPENDED",policies.projection(2).accessMode());
        verifyNoInteractions(sandboxes);
    }
    @Test void runningProvisionCannotBeInterruptedAndFailedAcceptanceRollsBack() {
        jdbc.update("UPDATE byai.tenant_runtime_operation SET active_command_id=1,state='ACTIVE' WHERE enterprise_id=2");
        makeProvisionRunning();
        assertThrows(ResponseStatusException.class,()->service.request(2,"tenant",10001));
        assertEquals("RUNNING",store.find(1).status());assertTrue(state().contains("READY"));verifyNoInteractions(policies);
        jdbc.update("UPDATE byai.internal_command SET status='MANUAL_REQUIRED',lease_until=NULL WHERE id=1");
        doThrow(new IllegalStateException("outbox unavailable")).when(hooks).publishDurable(anyString(),anyInt(),anyString(),anyString(),anyString(),anyString(),anyMap());
        assertThrows(IllegalStateException.class,()->service.request(2,"tenant",10001));
        assertEquals("MANUAL_REQUIRED",store.find(1).status());assertNull(store.find(10));assertTrue(state().contains("READY"));
    }
    @Test void pausedProvisionIsFencedAndItsExternalReceiptExplainsDeletion() {
        jdbc.update("UPDATE byai.tenant_runtime_operation SET active_command_id=1,state='ACTIVE' WHERE enterprise_id=2");
        var lease=makeProvisionRunning();
        jdbc.update("UPDATE byai.internal_command SET status='MANUAL_REQUIRED',lease_until=NULL WHERE id=1");
        service.request(2,"tenant",10001);
        assertEquals("FAILED",store.find(1).status());assertEquals("TENANT_DELETION_REQUESTED",store.find(1).errorCode());
        assertThrows(TenantCommandException.class,()->store.fence(lease));
        verify(hooks).publishDurable(eq("tenant.provisioning.failed"),eq(1),eq("2"),anyString(),eq("1"),eq("1"),anyMap());
    }
    @Test void pendingNasCleanupRetainsMembershipsAndRetriesBeforePublishingDeleted() {
        service.request(2,"tenant",10001);var lease=store.claim(10,"worker",Duration.ofMinutes(30));
        var pending=new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"tenant.volume.cleanup.pending");
        doThrow(pending).doNothing().when(sandboxes).deleteTenantResources(2);
        assertThrows(ResponseStatusException.class,()->service.execute(lease));service.failed(lease,pending);
        assertEquals("RETRY_WAIT",store.find(10).status());assertTrue(state().contains("DELETING"));
        verify(tenants,never()).deleteTenantMemberships(anyLong());
        jdbc.update("UPDATE byai.internal_command SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=10");
        var retry=store.claim(10,"worker-2",Duration.ofMinutes(30));service.execute(retry);
        assertEquals("SUCCEEDED",store.find(10).status());assertTrue(state().contains("DELETED"));
        assertNull(tenants.selectConfig(2,"DB_PASSWORD"));assertEquals("hacu",tenants.selectConfig(2,"INTEGRATION_SOURCE_SYSTEM"));
        assertNull(jdbc.queryForObject("SELECT active_command_id FROM byai.tenant_runtime_operation WHERE enterprise_id=2",Long.class));
        verify(hooks).publishDurable(eq("tenant.deleted"),eq(1),eq("2"),anyString(),eq("1"),eq("10"),anyMap());
        assertEquals("COMPLETED",service.request(2,"tenant",10001));
    }
    @Test void unknownProviderIdentifiersFailClosedAndRetryKeepsSameCommand() {
        service.request(2,"tenant",10001);var lease=store.claim(10,"worker",Duration.ofMinutes(30));
        jdbc.update("INSERT INTO byai.ss_sandbox_record VALUES(2,'TENANT','tenant-opengauss','FAILED',NULL)");
        var failure=assertThrows(ResponseStatusException.class,()->service.execute(lease));service.failed(lease,failure);
        verifyNoInteractions(sandboxes);assertEquals("MANUAL_REQUIRED",store.find(10).status());
        assertEquals("TENANT_DELETE_RESOURCE_UNCERTAIN",store.find(10).errorCode());assertTrue(state().contains("DELETE_FAILED"));
        assertEquals("ACCEPTED",service.request(2,"tenant",10001));assertEquals("PENDING",store.find(10).status());
        assertThrows(TenantCommandException.class,()->service.execute(lease));
    }
    @Test void failedRequestedEventRollsBackSuspensionCommandAndState() {
        doThrow(new IllegalStateException("outbox unavailable")).when(hooks).publishDurable(
            eq("tenant.deletion.requested"),anyInt(),anyString(),anyString(),anyString(),anyString(),anyMap());
        assertThrows(IllegalStateException.class,()->service.request(2,"tenant",10001));
        assertEquals("PREPARED",policies.projection(2).accessMode());
        assertTrue(state().contains("READY"));assertNull(store.latestDeletion(2));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM byai.tenant_execution_policy",Integer.class));
    }
    @Test void concurrentClicksReserveOnlyOneCommandAndPolicyRevision() throws Exception {
        var start=new java.util.concurrent.CountDownLatch(1);
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var first=pool.submit(()->{start.await();return service.request(2,"tenant",10001);});
            var second=pool.submit(()->{start.await();return service.request(2,"tenant",10001);});
            start.countDown();
            assertEquals("ACCEPTED",first.get(10,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("ACCEPTED",second.get(10,java.util.concurrent.TimeUnit.SECONDS));
        }
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM byai.internal_command",Integer.class));
        assertEquals("2",policies.projection(2).desiredRevision());
    }
    private TenantCommandStore.Lease makeProvisionRunning() {
        jdbc.update("UPDATE byai.internal_command SET status='PENDING' WHERE id=1");
        return store.claim(1,"provision-worker",Duration.ofMinutes(30));
    }
}
