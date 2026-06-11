package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OpenClawCronDueJobReaderTest {

    private final OpenClawCronDueJobReader reader = new OpenClawCronDueJobReader();

    @TempDir
    Path tempDir;

    @Test
    void readsEnabledNotRunningJobsInsideLookaheadWindow() throws Exception {
        assumeSqliteAvailable();
        Path database = tempDir.resolve("openclaw.sqlite");
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database.toAbsolutePath());
            Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE cron_jobs (
                    job_id TEXT PRIMARY KEY,
                    enabled INTEGER NOT NULL,
                    next_run_at_ms INTEGER,
                    running_at_ms INTEGER,
                    agent_id TEXT,
                    session_key TEXT,
                    session_target TEXT,
                    payload_kind TEXT
                )
                """);
            statement.execute("""
                INSERT INTO cron_jobs(job_id, enabled, next_run_at_ms, running_at_ms, agent_id, session_key, session_target, payload_kind)
                VALUES
                    ('due', 1, 1100, NULL, 'agent-a', 'session-a', 'target-a', 'message'),
                    ('running', 1, 1200, 1190, 'agent-b', 'session-b', 'target-b', 'message'),
                    ('disabled', 0, 1300, NULL, 'agent-c', 'session-c', 'target-c', 'message'),
                    ('too-late', 1, 1700, NULL, 'agent-d', 'session-d', 'target-d', 'message')
                """);
        }

        OpenClawCronDueJobs result = reader.readDueJobs(database, 1000, 500, 10);

        assertThat(result.getStatus()).isEqualTo(OpenClawCronDueJobs.Status.READY);
        assertThat(result.getJobs()).hasSize(1);
        OpenClawCronDueJob job = result.getJobs().get(0);
        assertThat(job.getJobId()).isEqualTo("due");
        assertThat(job.getNextRunAtMs()).isEqualTo(1100L);
        assertThat(job.getAgentId()).isEqualTo("agent-a");
        assertThat(job.getSessionKey()).isEqualTo("session-a");
        assertThat(job.getSessionTarget()).isEqualTo("target-a");
        assertThat(job.getPayloadKind()).isEqualTo("message");
    }

    @Test
    void reportsMissingCronJobsTable() throws Exception {
        assumeSqliteAvailable();
        Path database = tempDir.resolve("missing-table.sqlite");
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database.toAbsolutePath());
            Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE other_table (id TEXT PRIMARY KEY)");
        }

        OpenClawCronDueJobs result = reader.readDueJobs(database, 1000, 500, 10);

        assertThat(result.getStatus()).isEqualTo(OpenClawCronDueJobs.Status.MISSING_TABLE);
        assertThat(result.getJobs()).isEmpty();
    }

    @Test
    void reportsMissingRequiredColumns() throws Exception {
        assumeSqliteAvailable();
        Path database = tempDir.resolve("missing-columns.sqlite");
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database.toAbsolutePath());
            Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE cron_jobs (job_id TEXT PRIMARY KEY, enabled INTEGER)");
        }

        OpenClawCronDueJobs result = reader.readDueJobs(database, 1000, 500, 10);

        assertThat(result.getStatus()).isEqualTo(OpenClawCronDueJobs.Status.MISSING_COLUMNS);
        assertThat(result.getMissingColumns()).containsExactlyInAnyOrder("next_run_at_ms", "running_at_ms");
    }

    private void assumeSqliteAvailable() {
        try (Connection ignored = DriverManager.getConnection("jdbc:sqlite::memory:")) {
            // SQLite JDBC depends on a native library; skip these integration-style tests if the host blocks it.
        }
        catch (SQLException | UnsatisfiedLinkError | ExceptionInInitializerError e) {
            assumeTrue(false, "SQLite JDBC native library is unavailable on this host: " + e.getMessage());
        }
    }
}
