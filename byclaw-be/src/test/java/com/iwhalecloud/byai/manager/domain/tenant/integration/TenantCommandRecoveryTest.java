package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeSchemaService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real conditional SQL checks the original command, receipt, and step as one rollback boundary. */
class TenantCommandRecoveryTest {
    JdbcTemplate jdbc;
    TenantCommandStore store;
    TenantCommandRecovery recovery;
    TenantSandboxService sandboxes;
    TenantNodeSchemaService schemas;
    TenantAdminTenantMapper tenants;
    ObjectMapper json=new ObjectMapper();
    String request="11111111-1111-4111-8111-111111111111";

    @BeforeEach void setup() {
        var fixture=new TenantCommandStoreTest();fixture.setup();jdbc=fixture.jdbc;store=fixture.store;
        jdbc.execute("CREATE TABLE byai.tenant_task_step(command_id bigint,step_key varchar(64),status varchar(32),provider_request_key varchar(128),result text,revision bigint DEFAULT 0,PRIMARY KEY(command_id,step_key))");
        jdbc.execute("""
            CREATE TABLE byai.tenant_task_recovery(source_system varchar(64),request_id varchar(36),command_id bigint,
            enterprise_id bigint,request_hash varchar(64),expected_revision bigint,actor_type varchar(32),actor_id varchar(128),
            reason varchar(500),confirm_no_in_flight boolean,decision varchar(40),step_key varchar(64),receipt text,
            PRIMARY KEY(source_system,request_id))
            """);
        jdbc.update("UPDATE byai.tenant_task SET status='MANUAL_REQUIRED',stage='DB_CREATE',error_code='PROVIDER_RESULT_UNKNOWN' WHERE id=1");
        jdbc.update("INSERT INTO byai.tenant_operation_state(enterprise_id,active_command_id) VALUES (2,1)");
        jdbc.update("INSERT INTO byai.tenant_task_step(command_id,step_key,status,provider_request_key) VALUES (1,'DB_CREATE','STARTED','command-1:DB_CREATE')");
        sandboxes=mock(TenantSandboxService.class);schemas=mock(TenantNodeSchemaService.class);
        tenants=mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(2,"DB_PASSWORD")).thenReturn("persisted-envelope");
        when(sandboxes.inspectRecovery(2,"DB_CREATE","command-1:DB_CREATE"))
            .thenReturn(new TenantSandboxService.RecoveryResource("ABSENT",null,null));
        recovery=new TenantCommandRecovery(store,jdbc,sandboxes,tenants,schemas,json,
            new DataSourceTransactionManager(jdbc.getDataSource()));
    }
    private com.fasterxml.jackson.databind.JsonNode body(boolean confirm) throws Exception {
        return json.readTree("""
            {"requestId":"%s","expectedRevision":"0","actor":{"type":"PLATFORM_ADMIN","id":"admin-7"},
             "reason":"Administrator verified no provider creation remains in flight","confirmNoInFlight":%s}
            """.formatted(request,confirm));
    }
    @Test void historicalUnknownNeedsConfirmationAndPreservesOriginalIntent() throws Exception {
        assertEquals("RETRY_AFTER_CONFIRMATION",recovery.inspect(1).get("decision"));
        assertEquals(java.util.List.of("RESUME"),recovery.inspect(1).get("capabilities"));
        assertEquals("RECOVERY_CONFIRMATION_REQUIRED",assertThrows(TenantCommandException.class,()->recovery.recover(1,body(false))).getMessage());
        var accepted=recovery.recover(1,body(true));
        assertEquals("ACCEPTED",accepted.get("status"));assertEquals("1",accepted.get("commandRevision"));
        assertEquals("PENDING",store.find(1).status());
        assertEquals("command-1:DB_CREATE",jdbc.queryForObject("SELECT provider_request_key FROM byai.tenant_task_step",String.class));
        assertEquals("RETRY_READY",jdbc.queryForObject("SELECT status FROM byai.tenant_task_step",String.class));
        assertEquals(1L,jdbc.queryForObject("SELECT operation_revision FROM byai.tenant_operation_state",Long.class));
        assertEquals(1L,jdbc.queryForObject("SELECT fencing_token FROM byai.tenant_task WHERE id=1",Long.class));
    }
    @Test void persistedReceiptSurvivesCommandProgressAndRejectsChangedPayload() throws Exception {
        var accepted=recovery.recover(1,body(true));
        jdbc.update("UPDATE byai.tenant_task SET status='SUCCEEDED',revision=12 WHERE id=1");
        assertEquals(accepted,recovery.recover(1,body(true)));
        assertEquals(accepted,recovery.receipt(1,request));
        var changed=(com.fasterxml.jackson.databind.node.ObjectNode)body(true);changed.put("reason","different");
        assertEquals("RECOVERY_REQUEST_CONFLICT",assertThrows(TenantCommandException.class,()->recovery.recover(1,changed)).getMessage());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM byai.tenant_task_recovery",Integer.class));
    }
    @Test void unknownProviderAndUnverifiedSchemaCannotBeForced() throws Exception {
        when(sandboxes.inspectRecovery(anyLong(),anyString(),anyString()))
            .thenReturn(new TenantSandboxService.RecoveryResource("PROVIDER_QUERY_FAILED",null,null));
        assertEquals("MANUAL_REQUIRED",recovery.inspect(1).get("decision"));
        assertEquals("PROVIDER_QUERY_FAILED",assertThrows(TenantCommandException.class,()->recovery.recover(1,body(true))).getMessage());
        jdbc.update("UPDATE byai.tenant_task SET stage='SCHEMA_INIT' WHERE id=1");
        assertEquals("SCHEMA_AUDIT_RECONCILIATION_REQUIRED",assertThrows(TenantCommandException.class,()->recovery.recover(1,body(true))).getMessage());
    }
    @Test void explicitPreProviderFailureCanRetryWithoutConfirmation() throws Exception {
        jdbc.update("UPDATE byai.tenant_task SET error_code='PROVIDER_NOT_CALLED_FILE_PREPARATION' WHERE id=1");
        assertEquals("RETRY_SAFE",recovery.recover(1,body(false)).get("decision"));
    }
    @Test void exactExistingResourceIsAcknowledgedWithoutLaunch() throws Exception {
        var view=new TenantSandboxService.TenantSandboxView(8,"sandbox-id","tcp://database:5432");
        jdbc.execute("CREATE TABLE byai.ss_sandbox_record(id bigint,enterprise_id bigint,owner_scope varchar(32),sandbox_id varchar(64),status varchar(32),lock_version int,endpoint varchar(128))");
        jdbc.update("INSERT INTO byai.ss_sandbox_record VALUES (8,2,'TENANT','sandbox-id','RUNNING',0,'tcp://database:5432')");
        var record=new com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord();
        record.setId(8L);record.setEnterpriseId(2L);record.setSandboxId("sandbox-id");record.setLockVersion(0);record.setEndpoint("tcp://database:5432");
        when(sandboxes.inspectRecovery(anyLong(),anyString(),anyString()))
            .thenReturn(new TenantSandboxService.RecoveryResource("MATCHED",view,record));
        assertEquals("ADOPT_EXISTING",recovery.recover(1,body(false)).get("decision"));
        assertEquals("SUCCEEDED",jdbc.queryForObject("SELECT status FROM byai.tenant_task_step",String.class));
        assertEquals(view,json.readValue(jdbc.queryForObject("SELECT result FROM byai.tenant_task_step",String.class),TenantSandboxService.TenantSandboxView.class));
        verify(sandboxes,never()).launchOpenGauss(anyLong(),anyString(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void slotChangesDuringProviderReadRollBackCommandAndReceipt() throws Exception {
        when(sandboxes.inspectRecovery(anyLong(),anyString(),anyString())).thenAnswer(invocation->{
            jdbc.update("UPDATE byai.tenant_operation_state SET operation_revision=operation_revision+1");
            return new TenantSandboxService.RecoveryResource("ABSENT",null,null);
        });
        assertEquals("RECOVERY_OPERATION_SLOT_CHANGED",assertThrows(TenantCommandException.class,()->recovery.recover(1,body(true))).getMessage());
        assertEquals("MANUAL_REQUIRED",store.find(1).status());assertEquals(0,store.find(1).revision());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM byai.tenant_task_recovery",Integer.class));
        assertEquals("STARTED",jdbc.queryForObject("SELECT status FROM byai.tenant_task_step",String.class));
    }
    @Test void stepChangeDuringProviderReadRollsBackCommand() throws Exception {
        when(sandboxes.inspectRecovery(anyLong(),anyString(),anyString())).thenAnswer(invocation->{
            jdbc.update("UPDATE byai.tenant_task_step SET revision=revision+1");
            return new TenantSandboxService.RecoveryResource("ABSENT",null,null);
        });
        assertEquals("RECOVERY_STEP_CHANGED",assertThrows(TenantCommandException.class,()->recovery.recover(1,body(true))).getMessage());
        assertEquals("MANUAL_REQUIRED",store.find(1).status());
    }
    @Test void confirmedRequestStillPerformsFreshProviderInspection() throws Exception {
        assertEquals("RETRY_AFTER_CONFIRMATION",recovery.inspect(1).get("decision"));
        when(sandboxes.inspectRecovery(anyLong(),anyString(),anyString()))
            .thenReturn(new TenantSandboxService.RecoveryResource("MULTIPLE_PROVIDER_RESOURCES",null,null));
        assertEquals("MULTIPLE_PROVIDER_RESOURCES",assertThrows(TenantCommandException.class,()->recovery.recover(1,body(true))).getMessage());
    }
    @Test void onlyOriginalVerifiedSchemaAuditCanAcknowledgeUnknownStep() throws Exception {
        jdbc.update("UPDATE byai.tenant_task SET stage='SCHEMA_INIT' WHERE id=1");
        jdbc.update("UPDATE byai.tenant_task_step SET step_key='SCHEMA_INIT',provider_request_key='command-1:SCHEMA_INIT'");
        when(tenants.selectConfig(2,"PROVISION_REQUEST_ID")).thenReturn("original-request");
        when(tenants.selectConfig(2,"DB_SANDBOX_RECORD_ID")).thenReturn("8");
        assertEquals("SCHEMA_AUDIT_RECONCILIATION_REQUIRED",recovery.inspect(1).get("reasonCode"));
        when(schemas.verifiedRecoveryAudit(2,"original-request",8)).thenReturn(true);
        assertEquals("ADOPT_EXISTING",recovery.recover(1,body(false)).get("decision"));
        assertEquals("true",jdbc.queryForObject("SELECT result FROM byai.tenant_task_step",String.class));
        verify(schemas,never()).initialize(anyLong(),anyLong(),anyLong(),any(),anyString(),anyLong());
    }

}
