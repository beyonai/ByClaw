package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import static org.junit.jupiter.api.Assertions.*;

class TenantInternalEnterpriseServiceTest {
    private JdbcTemplate jdbc;
    private TransactionTemplate transaction;
    private TenantInternalEnterpriseService service;
    private final com.iwhalecloud.byai.common.quota.SharedQuotaReader quotas = org.mockito.Mockito.mock(com.iwhalecloud.byai.common.quota.SharedQuotaReader.class);
    private void limit(int members) {
        org.mockito.Mockito.when(quotas.read(42L)).thenReturn(java.util.Optional.of(
            new com.iwhalecloud.byai.common.quota.QuotaSnapshot(42L, "1", members, 5, 5, 5)));
    }
    private final ObjectMapper mapper = new ObjectMapper();
    @BeforeEach void setup() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:members" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.quota_write_guard(scope VARCHAR(32),subject_id BIGINT,version BIGINT NOT NULL,PRIMARY KEY(scope,subject_id))");
        jdbc.execute("CREATE TABLE byai.po_enterprise_info(enterprise_id BIGINT PRIMARY KEY,com_acct_name VARCHAR(200))");
        jdbc.execute("CREATE TABLE byai.po_users(user_id BIGINT PRIMARY KEY,state VARCHAR(1),is_locked VARCHAR(1),user_eff_date TIMESTAMP,user_exp_date TIMESTAMP)");
        jdbc.execute("CREATE TABLE byai.tenant_config(enterprise_id BIGINT,params_code VARCHAR(64),params_value TEXT,params_version BIGINT DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE byai.tenant_user_membership(membership_id BIGINT PRIMARY KEY,enterprise_id BIGINT,user_id BIGINT,role VARCHAR(16),status VARCHAR(16),created_by BIGINT,joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(enterprise_id,user_id))");
        jdbc.update("INSERT INTO byai.po_enterprise_info VALUES(42,'Original')");
        jdbc.update("INSERT INTO byai.po_users(user_id,state,is_locked) VALUES(1,'A','N'),(2,'A','N'),(3,'D','N')");
        jdbc.update("INSERT INTO byai.tenant_config(enterprise_id,params_code,params_value,params_version) VALUES(42,'PACKAGE_CONTENT_SNAPSHOT','{\"memberLimit\":2}',1)");
        jdbc.update("INSERT INTO byai.tenant_user_membership(membership_id,enterprise_id,user_id,role,status,created_by) VALUES(1,42,1,'OWNER','ACTIVE',1)");
        var sequence = new SequenceService() {
            private final java.util.concurrent.atomic.AtomicLong next = new java.util.concurrent.atomic.AtomicLong(10);
            @Override public Long nextVal() { return next.getAndIncrement(); }
        };
        limit(2);
        service = new TenantInternalEnterpriseService(jdbc, sequence, new com.iwhalecloud.byai.common.quota.SharedQuotaAdmission(quotas, jdbc));
        transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
    }
    @Test void insertsValidMemberAndRollsBackWithOuterCommand() throws Exception {
        var body = mapper.readTree("{\"userId\":\"2\",\"role\":\"MEMBER\",\"createdByUserId\":\"1\"}");
        transaction.executeWithoutResult(status -> {
            assertEquals("2", service.addMember(42, body).userId());
            assertEquals(2, service.listMembers(42).size());
            status.setRollbackOnly();
        });
        assertEquals(1, service.listMembers(42).size());
        assertEquals(1L, jdbc.queryForObject("SELECT params_version FROM byai.tenant_config", Long.class));
    }
    @Test void quotaAndInvalidUsersCannotBypassMembershipConstraint() throws Exception {
        var body = mapper.readTree("{\"userId\":\"2\",\"role\":\"MEMBER\",\"createdByUserId\":\"1\"}");
        limit(1);
        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(status -> service.addMember(42, body)));
        limit(3);
        var invalid = body.deepCopy(); ((com.fasterxml.jackson.databind.node.ObjectNode) invalid).put("userId", "3");
        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(status -> service.addMember(42, invalid)));
        assertEquals(1, service.listMembers(42).size());
    }
    @Test void concurrentAdmissionsCannotExceedLatestMemberLimit() throws Exception {
        jdbc.update("INSERT INTO byai.po_users(user_id,state,is_locked) VALUES(4,'A','N')");
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var attempts = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
            for (String user : java.util.List.of("2", "4")) {
                var body = mapper.createObjectNode().put("userId", user).put("role", "MEMBER").put("createdByUserId", "1");
                attempts.add(workers.submit(() -> {
                    start.await();
                    try {
                        transaction.executeWithoutResult(status -> service.addMember(42, body));
                        return true;
                    } catch (org.springframework.web.server.ResponseStatusException denied) {
                        assertEquals("tenant.member.limit.reached", denied.getReason());
                        return false;
                    }
                }));
            }
            start.countDown();
            int successes = 0;
            for (var attempt : attempts) if (attempt.get(10, java.util.concurrent.TimeUnit.SECONDS)) successes++;
            assertEquals(1, successes);
            assertEquals(2, service.listMembers(42).size());
        }
    }
    @Test void missingPackageAllowsValidMembersAndRepeatedActiveAdmissionConsumesNoSeat() throws Exception {
        org.mockito.Mockito.when(quotas.read(42L)).thenReturn(java.util.Optional.empty());
        jdbc.update("DELETE FROM byai.tenant_config");
        var body = mapper.readTree("{\"userId\":\"2\",\"role\":\"MEMBER\",\"createdByUserId\":\"1\"}");
        transaction.executeWithoutResult(status -> service.addMember(42, body));
        limit(1);
        transaction.executeWithoutResult(status -> assertEquals("2", service.addMember(42, body).userId()));
        assertEquals(2, service.listMembers(42).size());
    }
    @Test void updateIsNarrowAndOwnerMutationUnsupported() throws Exception {
        var name = mapper.readTree("{\"enterpriseName\":\"Changed\"}");
        transaction.executeWithoutResult(status -> service.updateEnterprise(42, name));
        assertEquals("Changed", service.getEnterprise(42).enterpriseName());
        var unsupported = mapper.readTree("{\"enterpriseName\":\"Changed\",\"ownerUserId\":\"2\"}");
        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(status -> service.updateEnterprise(42, unsupported)));
        var owner = mapper.readTree("{\"userId\":\"2\",\"role\":\"OWNER\",\"createdByUserId\":\"1\"}");
        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(status -> service.addMember(42, owner)));
        assertThrows(RuntimeException.class, () -> service.updateEnterprise(42, name));
        assertEquals("OWNER", service.listMembers(42).getFirst().role());
    }
}
