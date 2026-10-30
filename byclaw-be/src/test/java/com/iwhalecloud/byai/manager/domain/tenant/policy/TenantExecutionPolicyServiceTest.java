package com.iwhalecloud.byai.manager.domain.tenant.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.common.quota.TestSharedPolicies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class TenantExecutionPolicyServiceTest {
    final ObjectMapper mapper = new ObjectMapper();
    JdbcTemplate jdbc;
    TransactionTemplate tx;
    TestSharedPolicies shared;
    TenantExecutionPolicyService service;
    JsonNode policy(String override) throws Exception {
        var value = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree("{\"revision\":\"1\",\"accessMode\":\"PREPARED\",\"limits\":{\"memberLimit\":10,\"groupLimit\":15,\"groupMemberLimit\":10,\"storageBytes\":\"1024\",\"agentLimit\":50,\"parallelTaskLimit\":5}}");
        value.setAll((com.fasterxml.jackson.databind.node.ObjectNode)mapper.readTree(override)); return value;
    }
    @BeforeEach void setup() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:policy"+System.nanoTime()+";DB_CLOSE_DELAY=-1","sa","");
        jdbc=new JdbcTemplate(ds); tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.tenant_config(enterprise_id bigint,params_code varchar(64),params_value text)");
        jdbc.execute("CREATE TABLE byai.tenant_operation_state(enterprise_id bigint PRIMARY KEY,active_command_id bigint,operation_revision bigint DEFAULT 0,policy_revision bigint,runtime_generation varchar(64) DEFAULT '0',applied_rule_revision bigint,applied_runtime_generation varchar(64),rule_applied_at timestamp with time zone)");
        jdbc.update("INSERT INTO byai.tenant_config VALUES(12,'COMMERCIAL_MANAGED','true')");
        shared=new TestSharedPolicies(); service=new TenantExecutionPolicyService(jdbc,mapper,shared.reader,false,Clock.fixed(Instant.parse("2026-10-29T00:00:00Z"),ZoneOffset.UTC));
    }
    void prepare() throws Exception { var initial=policy("{}"); tx.executeWithoutResult(s->service.prepare(12,initial)); }
    @Test void reservationDoesNotNeedRedisButProvisioningWaitsForPublication() throws Exception {
        prepare();
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.requireProvisioning(12));
        shared.publish(12,policy("{}")); assertDoesNotThrow(()->service.requireProvisioning(12));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->service.requireExecution(12));
    }
    @Test void noRuleTableAndRedisChangeImmediatelyChangesAdmission() throws Exception {
        prepare(); shared.publish(12,policy("{\"accessMode\":\"ENABLED\",\"effectiveFrom\":\"2026-10-28T00:00:00Z\",\"effectiveUntil\":\"2026-11-28T00:00:00Z\"}"));
        assertDoesNotThrow(()->service.requireExecution(12));
        shared.publish(12,policy("{\"revision\":\"2\",\"accessMode\":\"SUSPENDED\"}"));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->service.requireExecution(12));
        assertEquals("2",service.projection(12).desiredRevision()); assertFalse(service.projection(12).fullyApplied());
    }
    @Test void expiredFutureAndMissingIntervalDenyEnabled() throws Exception {
        prepare();
        for(String period:new String[]{"",",\"effectiveFrom\":\"2026-10-30T00:00:00Z\",\"effectiveUntil\":\"2026-11-01T00:00:00Z\"",",\"effectiveFrom\":\"2026-10-01T00:00:00Z\",\"effectiveUntil\":\"2026-10-28T00:00:00Z\""}) {
            shared.publish(12,policy("{\"accessMode\":\"ENABLED\""+period+"}"));
            assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->service.requireExecution(12));
        }
    }
    @Test void policyCommandOnlyConfirmsAlreadyPublishedVersion() throws Exception {
        prepare(); shared.publish(12,policy("{}")); var next=policy("{\"revision\":\"2\",\"accessMode\":\"SUSPENDED\"}");
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->tx.executeWithoutResult(s->service.update(12,1,next)));
        assertEquals(1L,jdbc.queryForObject("SELECT policy_revision FROM byai.tenant_operation_state",Long.class));
        shared.publish(12,next);tx.executeWithoutResult(s->service.update(12,1,next));
        assertEquals("SUSPENDED",service.projection(12).accessMode());
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->tx.executeWithoutResult(s->service.update(12,1,next)));
    }
    @Test void mismatchedRequestCannotChangePublishedRule() throws Exception {
        prepare(); shared.publish(12,policy("{\"revision\":\"2\",\"accessMode\":\"SUSPENDED\"}"));
        var mismatch=policy("{\"revision\":\"2\",\"accessMode\":\"READ_ONLY\"}");
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->tx.executeWithoutResult(s->service.update(12,1,mismatch)));
        assertEquals("SUSPENDED",service.projection(12).accessMode());
    }
    @Test void confirmPreservesTimestampRejectsStaleIdentityAndRollsBack() throws Exception {
        prepare();shared.publish(12,policy("{}"));tx.executeWithoutResult(s->{service.setGeneration(12,"1");service.acknowledge(12,1,"1","main-service");});
        var first=jdbc.queryForObject("SELECT rule_applied_at FROM byai.tenant_operation_state",java.sql.Timestamp.class);
        tx.executeWithoutResult(s->service.acknowledge(12,1,"1","main-service"));
        assertEquals(first,jdbc.queryForObject("SELECT rule_applied_at FROM byai.tenant_operation_state",java.sql.Timestamp.class));
        shared.publish(12,policy("{\"revision\":\"2\"}"));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->tx.executeWithoutResult(s->service.acknowledge(12,1,"1","main-service")));
        tx.executeWithoutResult(s->{service.acknowledge(12,2,"1","main-service");s.setRollbackOnly();});
        assertEquals(1L,jdbc.queryForObject("SELECT applied_rule_revision FROM byai.tenant_operation_state",Long.class));
        tx.executeWithoutResult(s->service.acknowledge(12,2,"1","main-service"));
        assertEquals(2L,jdbc.queryForObject("SELECT applied_rule_revision FROM byai.tenant_operation_state",Long.class));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->tx.executeWithoutResult(s->service.acknowledge(12,2,"0","main-service")));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->tx.executeWithoutResult(s->service.acknowledge(12,2,"1","node")));
    }
    @Test void deletionBlocksWritesEvenIfSharedSnapshotStillEnabled() throws Exception {
        prepare();shared.publish(12,policy("{\"accessMode\":\"ENABLED\",\"effectiveFrom\":\"2026-10-28T00:00:00Z\",\"effectiveUntil\":\"2026-11-28T00:00:00Z\"}"));
        jdbc.update("INSERT INTO byai.tenant_config VALUES(12,'PROVISION_STATE','{\"status\":\"DELETING\"}')");
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->service.requireExecution(12));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->service.requireProvisioning(12));
    }
    @Test void absentUnmanagedTenantRetainsCompatibility() {
        assertDoesNotThrow(()->service.requireExecution(99));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.requireExecution(12));
    }
    @Test void generationAndReservationRollbackRemainTechnicalStateOnly() throws Exception {
        var initial=policy("{}");tx.executeWithoutResult(s->{service.prepare(12,initial);s.setRollbackOnly();});
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM byai.tenant_operation_state",Integer.class));prepare();
        tx.executeWithoutResult(s->service.setGeneration(12,"2"));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,()->tx.executeWithoutResult(s->service.setGeneration(12,"1")));
    }
}
