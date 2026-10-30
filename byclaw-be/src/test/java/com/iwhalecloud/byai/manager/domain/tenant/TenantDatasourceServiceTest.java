package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicInteger;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

class TenantDatasourceServiceTest {
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void tableListingRefreshesPrivateTransportAndPreservesLegacyTcp(boolean microvm) throws Exception {
        var tenants = mock(TenantAdminTenantMapper.class);
        var records = mock(SsSandboxRecordMapper.class);
        var crypto = mock(TenantCredentialCrypto.class);
        when(tenants.selectConfig(42, "DB_NAME")).thenReturn("byclaw_t_42");
        when(tenants.selectConfig(42, "DB_USER")).thenReturn("bc_t_42_admin");
        when(tenants.selectConfig(42, "DB_PASSWORD")).thenReturn("test-envelope");
        when(tenants.selectConfig(42, "DB_SANDBOX_RECORD_ID")).thenReturn("31");
        when(crypto.decrypt(42, "byclaw_t_42", "test-envelope")).thenReturn("test-only-password");
        SsSandboxRecord record = new SsSandboxRecord();
        record.setEnterpriseId(42L);
        record.setOwnerScope("TENANT");
        record.setSandboxType("tenant-opengauss");
        record.setStatus("RUNNING");
        record.setSandboxId(microvm ? "microvm--cn-beijing--sbx-test" : "c4858896-dcbb-47d3-a1ff-dd52bcf25f52");
        record.setEndpoint(microvm ? "https://15432-sbx-test.cn-beijing-vpc.sandbox.aliyuncs.com"
            : "tcp://192.168.0.83:57571/proxy/5432");
        when(records.selectById(31L)).thenReturn(record);
        var connection = mock(Connection.class);
        var statement = mock(PreparedStatement.class);
        var rows = mock(ResultSet.class);
        when(connection.prepareStatement(org.mockito.ArgumentMatchers.anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(rows);
        when(rows.next()).thenReturn(true, false, true, false);
        when(rows.getString(1)).thenReturn("byai");
        when(rows.getString(2)).thenReturn("ss_session");
        when(rows.getString(3)).thenReturn("BASE TABLE");
        var service = new TenantDatasourceService(tenants, records, crypto);
        var sandboxService = mock(TenantSandboxService.class);
        when(sandboxService.privateTransport(42, "tenant-opengauss")).thenReturn(
            java.util.Map.of("url", record.getEndpoint(), "trafficToken", "test-traffic-token"),
            java.util.Map.of("url", record.getEndpoint(), "trafficToken", "refreshed-test-token"));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "sandboxService", sandboxService);
        try (var user = mockStatic(CurrentUserHolder.class); var jdbc = mockStatic(DriverManager.class)) {
            user.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            jdbc.when(() -> DriverManager.getConnection(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(connection);
            jdbc.when(() -> DriverManager.getConnection(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(Properties.class))).thenReturn(connection);
            assertThat(service.tables(42)).containsExactly(
                new TenantDatasourceService.TableInfo("byai", "ss_session", "BASE TABLE"));
            assertThat(service.tables(42)).hasSize(1);
            if (microvm) {
                for (String token : java.util.List.of("test-traffic-token", "refreshed-test-token")) {
                    jdbc.verify(() -> DriverManager.getConnection(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.argThat(properties ->
                            PrivateDatabaseSocketFactory.class.getName().equals(properties.getProperty("socketFactory"))
                            && "wss://15432-sbx-test.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql"
                                .equals(properties.getProperty("byclawDatabaseUrl"))
                            && token.equals(properties.getProperty("byclawDatabaseToken"))
                            && "disable".equals(properties.getProperty("sslmode")))));
                }
                verify(sandboxService, times(2)).privateTransport(42, "tenant-opengauss");
            } else {
                jdbc.verify(() -> DriverManager.getConnection(org.mockito.ArgumentMatchers.anyString(),
                    org.mockito.ArgumentMatchers.argThat(properties ->
                        properties.getProperty("socketFactory") == null
                        && properties.getProperty("byclawDatabaseToken") == null
                        && "bc_t_42_admin".equals(properties.getProperty("user")))), times(2));
                org.mockito.Mockito.verifyNoInteractions(sandboxService);
            }
        }
        verify(connection, times(2)).close();
    }

    @Test
    void connectsToTenantDatabaseContainerBehindOpenSandboxProxy() {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setSandboxId("c4858896-dcbb-47d3-a1ff-dd52bcf25f52");
        record.setEndpoint("tcp://192.168.0.83:57571/proxy/5432");

        TenantDbProvisioningService.HostPort endpoint = TenantDatasourceService.databaseEndpoint(record);

        assertThat(endpoint.host()).isEqualTo("sandbox-c4858896-dcbb-47d3-a1ff-dd52bcf25f52");
        assertThat(endpoint.port()).isEqualTo(5432);
    }

    @Test
    void acceptsOneStatementWithQuotedSemicolon() {
        assertThat(TenantDatasourceService.singleStatement("SELECT ';' AS value;"))
            .isEqualTo("SELECT ';' AS value");
        assertThat(TenantDatasourceService.singleStatement("SELECT \"a;\" FROM byai.sample"))
            .isEqualTo("SELECT \"a;\" FROM byai.sample");
    }

    @Test
    void rejectsMultipleStatements() {
        assertThatThrownBy(() -> TenantDatasourceService.singleStatement("SELECT 1; DELETE FROM byai.sample"))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void requiresConfirmationForWritesEvenInsideCteOrExplain() {
        assertThat(TenantDatasourceService.requiresConfirmation("DELETE FROM byai.sample")).isTrue();
        assertThat(TenantDatasourceService.requiresConfirmation("DROP TABLE byai.sample")).isTrue();
        assertThat(TenantDatasourceService.requiresConfirmation(
            "WITH removed AS (DELETE FROM byai.sample RETURNING id) SELECT * FROM removed")).isTrue();
        assertThat(TenantDatasourceService.requiresConfirmation(
            "EXPLAIN ANALYZE DELETE FROM byai.sample")).isTrue();
        assertThat(TenantDatasourceService.requiresConfirmation("SELECT * INTO byai.backup FROM byai.sample"))
            .isTrue();
        assertThat(TenantDatasourceService.requiresConfirmation(
            "WITH note AS (SELECT '--' AS value), removed AS "
                + "(DELETE FROM byai.sample RETURNING id) SELECT * FROM removed")).isTrue();
        assertThat(TenantDatasourceService.requiresConfirmation(
            "WITH note AS (SELECT $$--$$ AS value), removed AS "
                + "(DELETE FROM byai.sample RETURNING id) SELECT * FROM removed")).isTrue();
    }

    @Test
    void allowsReadOnlyQueriesWithoutConfirmation() {
        assertThat(TenantDatasourceService.requiresConfirmation("SELECT 'drop table' AS note")).isFalse();
        assertThat(TenantDatasourceService.requiresConfirmation("/* note */ SELECT * FROM byai.sample"))
            .isFalse();
        assertThat(TenantDatasourceService.requiresConfirmation("WITH sample AS (SELECT 1) SELECT * FROM sample"))
            .isFalse();
        assertThat(TenantDatasourceService.requiresConfirmation("SHOW search_path")).isFalse();
        assertThat(TenantDatasourceService.requiresConfirmation("/* DELETE */ SELECT 1")).isFalse();
    }

    @Test
    void rejectsDangerousSqlWithoutServerSideConfirmation() {
        TenantDatasourceService service = new TenantDatasourceService(null, null, null, null);
        assertThatThrownBy(() -> service.execute(1, "DROP TABLE byai.sample", 1, false))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("tenant.datasource.sql.confirmation");
    }

    @Test
    void rejectsPageOutsideGuard() {
        TenantDatasourceService service = new TenantDatasourceService(null, null, null, null);
        assertThatThrownBy(() -> service.execute(1, "SELECT 1", 0, false))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("tenant.datasource.page.invalid");
        assertThatThrownBy(() -> service.execute(1, "SELECT 1", 10001, false))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("tenant.datasource.page.invalid");
    }

    @Test
    void paginatesInDatabaseAndKeepsAtMostFiveHundredRows() throws Exception {
        assertThat(TenantDatasourceService.pagedQuery("SELECT generate_series(1, 1001)", 2))
            .isEqualTo("SELECT * FROM (SELECT generate_series(1, 1001)) tenant_query_page LIMIT 501 OFFSET 500");
        ResultSet result = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        when(result.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(1);
        when(metadata.getColumnLabel(1)).thenReturn("value");
        when(metadata.getColumnTypeName(1)).thenReturn("integer");
        when(result.getString(1)).thenReturn("1");
        AtomicInteger row = new AtomicInteger();
        when(result.next()).thenAnswer(ignored -> row.incrementAndGet() <= 501);

        TenantDatasourceService.QueryResult page = TenantDatasourceService.toResult(result, 0, 2, true);
        assertThat(page.rows()).hasSize(500);
        assertThat(page.hasNextPage()).isTrue();
        assertThat(page.page()).isEqualTo(2);
        assertThat(page.pageSize()).isEqualTo(500);
    }
}
