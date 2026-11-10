package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

/** 真实 PostgreSQL 条件更新验证；只能使用显式指定的本机专用测试库，不自动创建或启动数据库。 */
@EnabledIfEnvironmentVariable(named = "MOBILE_PUSH_TEST_JDBC", matches = ".+")
class MobilePushStoreIntegrationTest {
    private static JdbcTemplate jdbc;
    private static boolean createdOwnTables;
    private MobilePushStore store;

    @BeforeAll
    static void createTablesInDedicatedDatabase() throws Exception {
        String address = System.getenv("MOBILE_PUSH_TEST_JDBC");
        assertThat(address).matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/byclaw_push_test");
        var dataSource = new DriverManagerDataSource(address,
            System.getenv().getOrDefault("MOBILE_PUSH_TEST_USER", "postgres"),
            System.getenv().getOrDefault("MOBILE_PUSH_TEST_PASSWORD", ""));
        jdbc = new JdbcTemplate(dataSource);
        // 测试库须预先创建 byai schema 且不含本次表；测试不会删除或重建已有 schema。
        String migration = Files.readString(Path.of("../deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"));
        String section = migration.substring(migration.indexOf("-- BEGIN MOBILE PUSH"),
            migration.indexOf("-- END MOBILE PUSH"));
        new ResourceDatabasePopulator(new ByteArrayResource(section.getBytes(StandardCharsets.UTF_8)))
            .execute(dataSource);
        createdOwnTables = true;
    }

    @BeforeEach
    void resetOnlyPushRows() {
        jdbc.update("DELETE FROM byai.byai_mobile_push_device");
        store = new MobilePushStore(jdbc);
    }

    @AfterAll
    static void removeOwnTables() {
        if (createdOwnTables) {
            jdbc.execute("DROP TABLE byai.byai_mobile_push_device");
        }
    }

    @Test
    void staleBindAndOldAccountUnbindCannotOverwriteNewAccount() {
        var first = new PushDeviceBinding("installation-test-device", 1, "registration", "ios", "zh-CN");
        var second = new PushDeviceBinding("installation-test-device", 3, "registration", "ios", "zh-CN");
        assertThat(store.bind(22, first)).isTrue();
        assertThat(store.bind(23, second)).isTrue();
        assertThat(store.bind(22, first)).isFalse();
        store.unbind(22, "installation-test-device", 4);
        assertThat(jdbc.queryForObject("SELECT account_id FROM byai.byai_mobile_push_device", Long.class))
            .isEqualTo(23L);
        assertThat(jdbc.queryForObject("SELECT enabled FROM byai.byai_mobile_push_device", Boolean.class)).isTrue();
    }

    @Test
    void unbindBeforeFirstBindLeavesATombstone() {
        store.unbind(22, "installation-test-device", 2);
        assertThat(store.bind(22, new PushDeviceBinding("installation-test-device", 1, "registration", "ios", "zh-CN")))
            .isFalse();
    }

    @Test
    void enabledDevicesAreIsolatedByAccountAndOldSnapshotsExpireOnRebindOrUnbind() {
        var ios = new PushDeviceBinding("installation-test-device", 1, "registration-ios", "ios", "zh-CN");
        var android = new PushDeviceBinding("installation-test-android", 1, "registration-android", "android", "en");
        store.bind(22, ios);
        store.bind(22, android);
        store.bind(23, new PushDeviceBinding("installation-another-user", 1, "registration-other", "ios", "en"));
        assertThat(store.devices(22)).containsExactlyInAnyOrder(ios, android);
        var notification = PushNotification.create("123:production", 1, 30, 40, 22, ios);
        assertThat(store.device(notification)).isEqualTo(ios);
        store.bind(22, new PushDeviceBinding(ios.installationId(), 2, "registration-new", "ios", "zh-CN"));
        assertThat(store.device(notification)).isNull();
        store.unbind(22, ios.installationId(), 3);
        assertThat(store.devices(22)).containsExactly(android);
        assertThat(store.devices(23)).hasSize(1);
    }
}
