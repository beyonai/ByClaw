package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.manager.entity.groupchat.*;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatForwardMapper;
import java.nio.file.*;
import java.sql.*;
import java.time.Instant;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.*;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.*;

/** Executes the shipped DDL and mapper SQL, including the exact fencing predicates. */
public class GroupChatForwardStoreTest {
    private String url;
    @BeforeEach void fixture() throws Exception {
        url = "jdbc:h2:mem:forward" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        execute("CREATE SCHEMA byai");
        execute("CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT PRIMARY KEY)");
        // H2 exposes the production database's documented wall-clock function through a test-only alias.
        execute("CREATE ALIAS clock_timestamp FOR \"com.iwhalecloud.byai.state.domain.groupchat.forward.GroupChatForwardStoreTest.clockTimestamp\"");
        String ddl = Files.readString(Path.of("../deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"));
        execute(ddl.replace("SET search_path TO byai;", "SET SCHEMA byai;"));
    }
    @Test void uniqueRequestBindsActorAndHash() {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            assertThat(mapper.insertRequest(request(101L, 1L, 30L))).isOne();
            assertThatThrownBy(() -> mapper.insertRequest(request(102L, 1L, 30L))).isInstanceOf(Exception.class);
            assertThat(mapper.insertRequest(request(103L, 1L, 31L))).isOne();
            assertThat(mapper.insertRequest(request(104L, 2L, 30L))).isOne();
            assertThat(mapper.requestByKey(1L, 30L, "same-key").getRequestHash()).isEqualTo("a".repeat(64));
            assertThat(mapper.requestByKey(3L, 30L, "same-key")).isNull();
            mapper.insertTarget(target(201L, 101L, 2000L));
            assertThatThrownBy(() -> mapper.insertTarget(target(202L, 101L, 2000L))).isInstanceOf(Exception.class);
        }
    }
    @Test void staleLeaseCannotCheckpointOrOverwriteSuccess() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            assertThat(mapper.claimTarget(1L, 201L, "old", 120_000L)).isOne();
            assertThat(mapper.claimTarget(1L, 201L, "new", 120_000L)).isZero();
            session.getConnection().createStatement().execute("UPDATE byai.byai_group_chat_forward_target SET lease_until=TIMESTAMP '2000-01-01 00:00:00'");
            assertThat(mapper.claimTarget(1L, 201L, "new", 120_000L)).isOne();
            assertThat(mapper.checkpoint(1L, 201L, "old", 1L, "{}", "READY")).isZero();
            assertThat(mapper.checkpoint(1L, 201L, "new", 2L, "{\"progress\":100}", "READY")).isOne();
            assertThat(mapper.succeedTarget(1L, 201L, "new", 3L, "[301]")).isOne();
            assertThat(mapper.failTarget(1L, 201L, "new", 3L, "COPY_FAILED", true)).isZero();
            assertThat(mapper.claimTarget(1L, 201L, "new", 120_000L)).isZero();
            assertThat(mapper.target(1L, 201L).getState()).isEqualTo("SUCCEEDED");
            assertThat(mapper.target(1L, 201L).getMessageIdsJson()).isEqualTo("[301]");
            assertThat(mapper.target(2L, 201L)).isNull();
        }
    }
    @Test void requestLeaseIsIndependentAndProofsCannotBeReplaced() {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            assertThat(mapper.claimRequest(1L, 101L, "resolver", 120_000L)).isOne();
            assertThat(mapper.claimRequest(1L, 101L, "other", 120_000L)).isZero();
            assertThat(mapper.freezeSources(1L, 101L, "resolver", 1L, "[{\"sourceId\":\"frozen\"}]")).isOne();
            assertThat(mapper.freezeSources(1L, 101L, "resolver", 1L, "[]")).isZero();
            assertThat(mapper.request(1L, 101L).getSourceManifestJson()).contains("frozen");
            assertThat(mapper.claimRequest(1L, 101L, "other", 120_000L)).isZero();
            assertThat(mapper.target(1L, 201L).getFencingVersion()).isZero();
        }
    }
    @Test void parentSnapshotCannotCascadeFromSourceDelete() throws Exception {
        execute("CREATE TABLE byai.byai_message(id BIGINT PRIMARY KEY)");
        execute("INSERT INTO byai.byai_message VALUES(301),(302)");
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            mapper.insertItem(item(401L));
            assertThatThrownBy(() -> mapper.insertItem(item(402L))).isInstanceOf(Exception.class);
            session.getConnection().createStatement().execute("DELETE FROM byai.byai_message");
            var item = mapper.items(1L, 201L).getFirst();
            assertThat(item.getContent()).isEqualTo("frozen original");
            assertThat(item.getSelectedMessageId()).isEqualTo(301L);
            assertThat(item.getSelectedMergedCard()).isTrue();
            assertThat(item.getSourceMessageId()).isEqualTo(302L);
        }
    }
    @Test void retryDeliveryAndAggregateCannotReopenSuccess() {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            mapper.claimTarget(1L, 201L, "worker", 120_000L);
            assertThat(mapper.failTarget(1L, 201L, "worker", 1L, "TEMPORARY", true)).isOne();
            assertThat(mapper.resetFailedTarget(1L, 201L)).isOne();
            assertThat(mapper.resetFailedTarget(1L, 201L)).isZero();
            mapper.claimTarget(1L, 201L, "worker", 120_000L);
            long version = mapper.target(1L, 201L).getFencingVersion();
            mapper.checkpoint(1L, 201L, "worker", version, "{}", "READY");
            assertThat(mapper.succeedTarget(1L, 201L, "worker", version + 1, "[301]")).isOne();
            assertThat(mapper.resetFailedTarget(1L, 201L)).isZero();
            assertThat(mapper.pendingDeliveries(1L, 10)).hasSize(1);
            assertThat(mapper.markDelivered(1L, 201L)).isOne();
            assertThat(mapper.pendingDeliveries(1L, 10)).isEmpty();
            assertThat(mapper.updateRequestState(1L, 101L, "SUCCEEDED")).isOne();
            assertThat(mapper.updateRequestState(1L, 101L, "RUNNING")).isZero();
        }
    }
    @Test void expiredLeaseCannotBindOrFreezeAndReadyCannotRegress() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L)); mapper.insertItem(item(401L));
            assertThat(mapper.recoverableTargets(1L, 10)).hasSize(1);
            assertThat(mapper.claimTarget(1L, 201L, "worker", 0L)).isZero();
            mapper.claimTarget(1L, 201L, "worker", 120_000L);
            assertThat(mapper.recoverableTargets(1L, 10)).isEmpty();
            assertThat(mapper.bindItem(1L, 201L, 401L, "worker", 1L, 501L, "[]")).isZero();
            mapper.checkpoint(1L, 201L, "worker", 1L, "{}", "READY");
            assertThat(mapper.checkpoint(1L, 201L, "worker", 2L, "{}", "COPYING")).isZero();
            assertThat(mapper.bindItem(1L, 201L, 401L, "old", 2L, 501L, "[]")).isZero();
            assertThat(mapper.bindItem(1L, 201L, 401L, "worker", 2L, 501L, "[]")).isOne();
            assertThat(mapper.bindItem(1L, 201L, 401L, "worker", 2L, 502L, "[]")).isZero();
            assertThat(mapper.items(1L, 201L).getFirst().getBoundMessageId()).isEqualTo(501L);
            assertThat(mapper.targets(1L, 101L)).hasSize(1);
            mapper.claimRequest(1L, 101L, "resolver", 120_000L);
            session.getConnection().createStatement().execute("UPDATE byai.byai_group_chat_forward_request SET lease_until=TIMESTAMP '2000-01-01 00:00:00'");
            assertThat(mapper.freezeSources(1L, 101L, "resolver", 1L, "[]")).isZero();
            session.getConnection().createStatement().execute("UPDATE byai.byai_group_chat_forward_target SET lease_until=TIMESTAMP '2000-01-01 00:00:00'");
            assertThat(mapper.checkpoint(1L, 201L, "worker", 2L, "{}", "READY")).isZero();
            assertThat(mapper.succeedTarget(1L, 201L, "worker", 2L, "[501]")).isZero();
        }
    }
    @Test void transactionRollbackRestoresMessageBindingsAndLease() {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L)); mapper.insertItem(item(401L));
            session.commit();
            mapper.claimTarget(1L, 201L, "worker", 120_000L);
            mapper.checkpoint(1L, 201L, "worker", 1L, "{}", "READY");
            mapper.bindItem(1L, 201L, 401L, "worker", 2L, 501L, "[]");
            mapper.succeedTarget(1L, 201L, "worker", 2L, "[501]");
            session.rollback();
            assertThat(mapper.target(1L, 201L).getState()).isEqualTo("PENDING");
            assertThat(mapper.items(1L, 201L).getFirst().getBoundMessageId()).isNull();
        }
    }
    @Test void renewalUsesDatabaseTimeKeepsFenceAndSurvivesOriginalDeadline() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            session.getConnection().createStatement().execute("UPDATE byai.byai_group_chat_forward_target SET fencing_version=9007199254740993");
            session.getConnection().createStatement().execute("UPDATE byai.byai_group_chat_forward_request SET fencing_version=9007199254740993");
            Instant oldDeadline = Instant.now().plusMillis(300);
            mapper.claimTarget(1L, 201L, "worker", 300L); mapper.claimRequest(1L, 101L, "resolver", 300L);
            var actor = new ForwardActor(30L, 1L);
            // Submitted leaseUntil is deliberately false: only the persisted DB deadline governs renewal.
            var targetLease = new TargetLease(101L, 201L, actor, 1000L, 2000L, "worker", 9007199254740994L, Instant.parse("2099-01-01T00:00:00Z"), ForwardState.COPYING);
            var requestLease = new RequestLease(101L, actor, "resolver", 9007199254740994L, Instant.parse("2099-01-01T00:00:00Z"));
            assertThat(mapper.renewTarget(targetLease, 3000L)).isOne();
            assertThat(mapper.renewRequest(requestLease, 3000L)).isOne();
            assertThat(mapper.target(1L, 201L).getFencingVersion()).isEqualTo(9007199254740994L);
            assertThat(mapper.request(1L, 101L).getFencingVersion()).isEqualTo(9007199254740994L);
            Instant renewed = mapper.target(1L, 201L).getLeaseUntil();
            assertThat(renewed).isBefore(Instant.now().plusSeconds(4));
            assertThat(mapper.renewTarget(targetLease, 10L)).isOne();
            assertThat(mapper.target(1L, 201L).getLeaseUntil()).isEqualTo(renewed);
            session.commit(); Thread.sleep(400);
            assertThat(Instant.now()).isAfter(oldDeadline);
            assertThat(mapper.checkpoint(1L, 201L, "worker", 9007199254740994L, "{}", "COPYING")).isOne();
            assertThat(mapper.freezeSources(1L, 101L, "resolver", 9007199254740994L, "[]")).isOne();
            assertThat(mapper.renewTarget(targetLease, 3000L)).isZero();
            assertThat(mapper.renewRequest(requestLease, 3000L)).isZero();
        }
    }
    @Test void renewalRejectsWrongOwnerFenceIdentityExpiryAndSuccess() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            mapper.claimTarget(1L, 201L, "worker", 120_000L); mapper.claimRequest(1L, 101L, "resolver", 120_000L);
            var actor = new ForwardActor(30L, 1L);
            assertThat(mapper.renewTarget(new TargetLease(101L, 201L, actor, 1000L, 2000L, "worker", 1L, future(), ForwardState.COPYING), 0L)).isZero();
            assertThat(mapper.renewRequest(new RequestLease(101L, actor, "resolver", 1L, future()), -1L)).isZero();
            for (var lease : new TargetLease[] {
                new TargetLease(101L, 201L, actor, 1000L, 2000L, "other", 1L, future(), ForwardState.COPYING),
                new TargetLease(101L, 201L, actor, 1000L, 2000L, "worker", 0L, future(), ForwardState.COPYING),
                new TargetLease(102L, 201L, actor, 1000L, 2000L, "worker", 1L, future(), ForwardState.COPYING),
                new TargetLease(101L, 201L, actor, 1001L, 2000L, "worker", 1L, future(), ForwardState.COPYING),
                new TargetLease(101L, 201L, new ForwardActor(31L, 1L), 1000L, 2000L, "worker", 1L, future(), ForwardState.COPYING),
                new TargetLease(101L, 201L, new ForwardActor(30L, 2L), 1000L, 2000L, "worker", 1L, future(), ForwardState.COPYING)
            }) assertThat(mapper.renewTarget(lease, 1000L)).isZero();
            assertThat(mapper.renewRequest(new RequestLease(101L, actor, "other", 1L, future()), 1000L)).isZero();
            assertThat(mapper.renewRequest(new RequestLease(101L, actor, "resolver", 0L, future()), 1000L)).isZero();
            assertThat(mapper.renewRequest(new RequestLease(101L, new ForwardActor(31L, 1L), "resolver", 1L, future()), 1000L)).isZero();
            mapper.checkpoint(1L, 201L, "worker", 1L, "{}", "READY"); mapper.succeedTarget(1L, 201L, "worker", 2L, "[501]");
            assertThat(mapper.renewTarget(new TargetLease(101L, 201L, actor, 1000L, 2000L, "worker", 3L, future(), ForwardState.SUCCEEDED), 1000L)).isZero();
            session.getConnection().createStatement().execute("UPDATE byai.byai_group_chat_forward_request SET lease_until=TIMESTAMP '2000-01-01 00:00:00'");
            assertThat(mapper.renewRequest(new RequestLease(101L, actor, "resolver", 1L, future()), 1000L)).isZero();
        }
    }
    @Test void initialClaimsUseDatabaseDurationWithoutAnAbsoluteDeadlineParameter() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            assertThat(mapper.claimTarget(1L, 201L, "worker", 1000L)).isOne();
            assertThat(mapper.claimRequest(1L, 101L, "resolver", 1000L)).isOne();
            try (var rows = session.getConnection().createStatement().executeQuery("SELECT lease_until > CURRENT_TIMESTAMP AND lease_until <= CURRENT_TIMESTAMP + INTERVAL '2' SECOND FROM byai.byai_group_chat_forward_target WHERE target_id=201")) {
                assertThat(rows.next()).isTrue(); assertThat(rows.getBoolean(1)).isTrue();
            }
            try (var rows = session.getConnection().createStatement().executeQuery("SELECT lease_until > CURRENT_TIMESTAMP AND lease_until <= CURRENT_TIMESTAMP + INTERVAL '2' SECOND FROM byai.byai_group_chat_forward_request WHERE request_id=101")) {
                assertThat(rows.next()).isTrue(); assertThat(rows.getBoolean(1)).isTrue();
            }
        }
    }
    @Test void transactionStartCannotKeepAnExpiredLeaseAlive() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L)); mapper.insertItem(item(401L));
            mapper.claimTarget(1L, 201L, "worker", 300L); mapper.claimRequest(1L, 101L, "resolver", 300L);
            mapper.checkpoint(1L, 201L, "worker", 1L, "{}", "READY");
            Thread.sleep(400);
            assertThat(mapper.checkpoint(1L, 201L, "worker", 2L, "{}", "READY")).isZero();
            assertThat(mapper.bindItem(1L, 201L, 401L, "worker", 2L, 501L, "[]")).isZero();
            assertThat(mapper.succeedTarget(1L, 201L, "worker", 2L, "[501]")).isZero();
            assertThat(mapper.failTarget(1L, 201L, "worker", 2L, "EXPIRED", true)).isZero();
            var actor = new ForwardActor(30L, 1L);
            assertThat(mapper.renewTarget(new TargetLease(101L, 201L, actor, 1000L, 2000L, "worker", 2L, future(), ForwardState.READY), 3000L)).isZero();
            assertThat(mapper.renewRequest(new RequestLease(101L, actor, "resolver", 1L, future()), 3000L)).isZero();
            assertThat(mapper.freezeSources(1L, 101L, "resolver", 1L, "[]")).isZero();
        }
    }
    @Test void delayedClaimUsesWallTimeInsideExistingTransaction() throws Exception {
        try (var session = open()) {
            var mapper = session.getMapper(ByaiGroupChatForwardMapper.class);
            mapper.insertRequest(request(101L, 1L, 30L)); mapper.insertTarget(target(201L, 101L, 2000L));
            Thread.sleep(300);
            mapper.claimTarget(1L, 201L, "worker", 200L); mapper.claimRequest(1L, 101L, "resolver", 200L);
            assertThat(mapper.target(1L, 201L).getLeaseUntil()).isAfter(Instant.now());
            assertThat(mapper.request(1L, 101L).getLeaseUntil()).isAfter(Instant.now());
        }
    }
    private ByaiGroupChatForwardRequest request(long id, long tenant, long actor) {
        var value = new ByaiGroupChatForwardRequest(); value.setRequestId(id); value.setEnterpriseId(tenant); value.setActorUserId(actor); value.setBackend("LEGACY");
        value.setSourceSessionId(1000L); value.setClientRequestId("same-key"); value.setMode("SINGLE"); value.setRequestHash("a".repeat(64));
        value.setFrozenJson("{}"); value.setSourceManifestJson("[]"); value.setSnapshotVersion(1); return value;
    }
    private ByaiGroupChatForwardTarget target(long id, long request, long group) {
        var value = new ByaiGroupChatForwardTarget(); value.setTargetId(id); value.setRequestId(request); value.setEnterpriseId(1L); value.setTargetSessionId(group); return value;
    }
    private ByaiGroupChatForwardItem item(long id) {
        var value = new ByaiGroupChatForwardItem(); value.setItemId(id); value.setEnterpriseId(1L); value.setRequestId(101L); value.setTargetId(201L);
        value.setOrdinal(0); value.setSelectedMessageId(301L); value.setSelectedMergedCard(true); value.setSourceMessageId(302L);
        value.setContent("frozen original"); value.setSpeakerJson("{}"); value.setSourceCreatedAt(Instant.parse("2026-10-15T00:00:00Z"));
        value.setReferencesJson("[]"); value.setAttachmentsJson("[]"); return value;
    }
    public static Timestamp clockTimestamp() { return Timestamp.from(Instant.now()); }
    private Instant future() { return Instant.now().plusSeconds(120); }
    private void execute(String sql) throws Exception { try (var c = DriverManager.getConnection(url); var s = c.createStatement()) { s.execute(sql); } }
    private SqlSession open() {
        var config = new MybatisConfiguration(new Environment("test", new JdbcTransactionFactory(), new UnpooledDataSource("org.h2.Driver", url, null, null)));
        config.setMapUnderscoreToCamelCase(true); config.addMapper(ByaiGroupChatForwardMapper.class);
        return new SqlSessionFactoryBuilder().build(config).openSession();
    }
}
