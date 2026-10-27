package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.hook.*;
import com.iwhalecloud.byai.manager.domain.tenant.TenantSandboxProperties;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.core.io.ByteArrayResource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;

/** Real SQL acceptance across command, existing MyBatis reservation, policy and durable event ownership. */
class TenantCommandAcceptanceTest {
    private final ObjectMapper json = new ObjectMapper();
    private JdbcTemplate jdbc;
    private TenantCommandService service;
    private TenantCommandStore store;
    private HookProperties hooks;
    private TenantSandboxProperties sandboxProperties;
    @BeforeEach void setup() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:acceptance" + System.nanoTime()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000", "sa", "");
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.po_users(user_id BIGINT PRIMARY KEY,state CHAR(1),is_locked CHAR(1),user_eff_date TIMESTAMP,user_exp_date TIMESTAMP)");
        jdbc.execute("CREATE TABLE byai.po_enterprise_info(enterprise_id BIGINT PRIMARY KEY,com_acct_name VARCHAR(200),com_acct_code VARCHAR(100),system_name VARCHAR(255))");
        jdbc.execute("CREATE TABLE byai.tenant_config(id BIGINT PRIMARY KEY,enterprise_id BIGINT NOT NULL REFERENCES byai.po_enterprise_info(enterprise_id),params_code VARCHAR(64),params_value TEXT NOT NULL,params_version BIGINT NOT NULL DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(enterprise_id,params_code))");
        jdbc.execute("CREATE TABLE byai.tenant_user_membership(membership_id BIGINT PRIMARY KEY,enterprise_id BIGINT NOT NULL REFERENCES byai.po_enterprise_info(enterprise_id),user_id BIGINT NOT NULL REFERENCES byai.po_users(user_id),role VARCHAR(16),status VARCHAR(16),created_by BIGINT NOT NULL,UNIQUE(enterprise_id,user_id))");
        Path root = Files.isDirectory(Path.of("deploy")) ? Path.of(".") : Path.of("..");
        String migration = Files.readString(root.resolve("deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"));
        String start = "-- BEGIN tenant service integration schema";
        String end = "-- END tenant service integration schema";
        int first = migration.indexOf(start), last = migration.indexOf(end);
        assertTrue(first >= 0 && last > first, "tenant integration schema section must exist in the release DDL");
        // H2 covers this feature's table/index DDL; PostgreSQL acceptance applies the entire release file.
        String sql = migration.substring(first + start.length(), last).replace("timestamptz", "TIMESTAMP WITH TIME ZONE");
        try (var connection = source.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ByteArrayResource(sql.getBytes(StandardCharsets.UTF_8)));
        }
        jdbc.update("INSERT INTO byai.po_users(user_id,state,is_locked) VALUES(1,'A','N')");
        var factory = new SqlSessionFactoryBean();
        factory.setDataSource(source);
        factory.setMapperLocations(new ClassPathResource("com/iwhalecloud/byai/manager/mapper/tenant/TenantAdminTenantMapper.xml"));
        var mapper = new SqlSessionTemplate(factory.getObject()).getMapper(TenantAdminTenantMapper.class);
        var ids = new SequenceService() {
            private final AtomicLong next = new AtomicLong(100);
            @Override public Long nextVal() { return next.getAndIncrement(); }
        };
        hooks = new HookProperties();
        var subscription = new HookProperties.Subscription(); subscription.setEvent("tenant.created");
        hooks.getSubscriptions().put("hacu", subscription);
        var durable = new DurableHookPublisher(source, hooks, List.of(new HookEventSchema("tenant.created", 1,
            Set.of("enterpriseId", "enterpriseName", "createdBy", "requestId", "provisionState"))));
        store = new TenantCommandStore(jdbc);
        sandboxProperties = new TenantSandboxProperties();
        service = new TenantCommandService(store, jdbc, mapper, ids, json, new HookPublisher(null, durable),
            new TenantExecutionPolicyService(jdbc, json, false, ""), new DataSourceTransactionManager(source),
            sandboxProperties);
    }
    private ObjectNode body(String requestId) throws Exception {
        return (ObjectNode) json.readTree("""
            {"sourceSystem":"HACU","requestId":"%s","ownerUserId":"1","enterpriseName":"Acceptance tenant",
             "actor":{"type":"PLATFORM_ADMIN","id":"platform-actor"},"reason":"subscription activation",
             "resourceSpec":{"profileKey":"s","bindingVersion":"1"},
             "initialPolicy":{"revision":"1","accessMode":"PREPARED","limits":{"memberLimit":2,
                "groupLimit":3,"groupMemberLimit":4,"storageBytes":"1024","agentLimit":5,"parallelTaskLimit":1}}}
            """.formatted(requestId));
    }
    private long count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM byai." + table, Long.class); }
    private void assertReservations(long expected) {
        for (String table : List.of("internal_command", "po_enterprise_info", "tenant_user_membership",
            "tenant_policy_cursor", "tenant_execution_policy", "tenant_runtime_operation", "integration_outbox", "integration_delivery")) {
            assertEquals(expected, count(table), table);
        }
        assertEquals(expected * 6, count("tenant_config"));
    }
    @Test void lostResponseReplayReturnsOriginalReservationAndStableEvent() throws Exception {
        var request = TenantCommandRequest.parse(body("request-lost-response"));
        var first = service.provision(request);
        String eventId = jdbc.queryForObject("SELECT event_id FROM byai.integration_outbox", String.class);
        // A lost response retry resolves the existing receipt before revalidating mutable base-user state.
        jdbc.update("UPDATE byai.po_users SET is_locked='Y' WHERE user_id=1");
        var replay = service.provision(request);
        assertEquals(first, replay);
        assertReservations(1);
        assertEquals(eventId, jdbc.queryForObject("SELECT event_id FROM byai.integration_outbox", String.class));
        assertEquals("OWNER", jdbc.queryForObject("SELECT role FROM byai.tenant_user_membership", String.class));
        assertEquals(1L, jdbc.queryForObject("SELECT created_by FROM byai.tenant_user_membership", Long.class));
        assertEquals("PREPARED", json.readTree(jdbc.queryForObject("SELECT payload FROM byai.tenant_execution_policy", String.class)).path("accessMode").asText());
        assertEquals(first.commandId(), jdbc.queryForObject("SELECT correlation_id FROM byai.integration_outbox", String.class));
    }
    @Test void differentPayloadConflictsAndSameRequestIdIsScopedBySource() throws Exception {
        var original = body("request-source-scope");
        service.provision(TenantCommandRequest.parse(original));
        var changed = original.deepCopy().put("enterpriseName", "Changed");
        assertEquals("REQUEST_ID_CONFLICT", assertThrows(TenantCommandException.class,
            () -> service.provision(TenantCommandRequest.parse(changed))).getMessage());
        assertReservations(1);
        service.provision(TenantCommandRequest.parse(original.deepCopy().put("sourceSystem", "OTHER")));
        assertReservations(2);
    }
    @Test void invalidOwnersLeaveNoCommandOrBusinessFact() throws Exception {
        jdbc.update("INSERT INTO byai.po_users(user_id,state,is_locked) VALUES(2,'D','N'),(3,'A','Y')");
        jdbc.update("INSERT INTO byai.po_users(user_id,state,is_locked,user_exp_date) VALUES(4,'A','N',TIMESTAMP '2000-01-01 00:00:00')");
        jdbc.update("INSERT INTO byai.po_users(user_id,state,is_locked,user_eff_date) VALUES(5,'A','N',TIMESTAMP '2999-01-01 00:00:00')");
        for (String owner : List.of("2", "3", "4", "5", "999")) {
            var request = TenantCommandRequest.parse(body("request-invalid-" + owner).put("ownerUserId", owner));
            var denied = assertThrows(TenantCommandException.class, () -> service.provision(request));
            assertEquals("OWNER_USER_INVALID", denied.getMessage());
            assertReservations(0);
        }
    }
    @Test void failureAfterOutboxInsertRollsBackEveryReservation() throws Exception {
        jdbc.execute("ALTER TABLE byai.integration_delivery ADD CONSTRAINT reject_delivery CHECK (status='DELIVERED')");
        var request = TenantCommandRequest.parse(body("request-atomic-failure"));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> service.provision(request));
        assertReservations(0);
        jdbc.execute("ALTER TABLE byai.integration_delivery DROP CONSTRAINT reject_delivery");
        service.provision(request);
        assertReservations(1);
    }
    @Test void concurrentIdenticalRequestHasOneCommandEnterpriseOwnerPolicyAndEvent() throws Exception {
        var request = TenantCommandRequest.parse(body("request-concurrent-same"));
        var start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> { start.await(); return service.provision(request); });
            var second = workers.submit(() -> { start.await(); return service.provision(request); });
            start.countDown();
            assertEquals(first.get(15, TimeUnit.SECONDS).commandId(), second.get(15, TimeUnit.SECONDS).commandId());
        }
        assertReservations(1);
    }

    @Test void omittedProfileIsFrozenOnceAndConfigurationChangesApplyOnlyToNewReservations() throws Exception {
        var original = body("request-default-profile");
        original.remove("resourceSpec");
        var first = service.provision(TenantCommandRequest.parse(original));
        assertEquals("m", frozenProfile(first));
        String storedRequest = jdbc.queryForObject("SELECT request_snapshot FROM byai.internal_command WHERE id=?",
            String.class, Long.parseLong(first.commandId()));
        assertFalse(json.readTree(storedRequest).has("resourceSpec"));

        // Emulate a new startup setting while replaying the original unmodified business request.
        sandboxProperties.setProfileKey("l");
        jdbc.update("UPDATE byai.po_users SET is_locked='Y' WHERE user_id=1");
        assertEquals(first, service.provision(TenantCommandRequest.parse(original)));
        assertEquals("m", frozenProfile(first));
        assertReservations(1);

        jdbc.update("UPDATE byai.po_users SET is_locked='N' WHERE user_id=1");
        var nextBody = body("request-new-default-profile");
        nextBody.putObject("resourceSpec");
        var next = service.provision(TenantCommandRequest.parse(nextBody));
        assertEquals("l", frozenProfile(next));
        assertReservations(2);
    }

    @Test void explicitTrustedProfilesOverrideDeploymentDefaultWithoutBindingVersion() throws Exception {
        sandboxProperties.setProfileKey("l");
        for (String profile : new String[]{"s", "m", "l"}) {
            var value = body("request-explicit-profile-" + profile);
            value.putObject("resourceSpec").put("profileKey", profile);
            var accepted = service.provision(TenantCommandRequest.parse(value));
            assertEquals(profile, frozenProfile(accepted));
            var snapshot = json.readTree(jdbc.queryForObject("SELECT params_value FROM byai.tenant_config"
                + " WHERE enterprise_id=? AND params_code='PACKAGE_CONTENT_SNAPSHOT'", String.class,
                Long.parseLong(accepted.enterpriseId())));
            assertEquals(2, snapshot.path("memberLimit").asInt());
        }
        assertReservations(3);
    }

    private String frozenProfile(TenantCommandStore.Command command) throws Exception {
        String snapshot = jdbc.queryForObject("SELECT params_value FROM byai.tenant_config"
            + " WHERE enterprise_id=? AND params_code='PACKAGE_CONTENT_SNAPSHOT'", String.class,
            Long.parseLong(command.enterpriseId()));
        return json.readTree(snapshot).path("profileKey").asText();
    }
}
