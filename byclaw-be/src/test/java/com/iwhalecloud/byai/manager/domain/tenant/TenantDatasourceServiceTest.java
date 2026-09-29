package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantDatasourceServiceTest {
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
            .hasMessageContaining("SQL requires confirmation");
    }

    @Test
    void rejectsPageOutsideGuard() {
        TenantDatasourceService service = new TenantDatasourceService(null, null, null, null);
        assertThatThrownBy(() -> service.execute(1, "SELECT 1", 0, false))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("invalid page");
        assertThatThrownBy(() -> service.execute(1, "SELECT 1", 10001, false))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("invalid page");
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
