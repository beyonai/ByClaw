package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Service;

@Service
public class OpenClawCronDueJobReader {

    private static final String TABLE_NAME = "cron_jobs";

    private static final List<String> REQUIRED_COLUMNS = List.of("enabled", "next_run_at_ms", "running_at_ms",
        "job_id");

    private static final List<String> OPTIONAL_COLUMNS = List.of("agent_id", "session_key", "session_target",
        "payload_kind");

    public OpenClawCronDueJobReader() {
        ensureSqliteDriverLoaded();
    }

    public OpenClawCronDueJobs readDueJobs(Path databaseFile, long nowMs, long lookaheadMs, int limit)
        throws SQLException {
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + databaseFile.toAbsolutePath())) {
            configureReadOnly(connection);
            if (!hasCronJobsTable(connection)) {
                return OpenClawCronDueJobs.missingTable();
            }
            Set<String> columns = loadColumns(connection);
            List<String> missingColumns = REQUIRED_COLUMNS.stream()
                .filter(column -> !columns.contains(column))
                .toList();
            if (!missingColumns.isEmpty()) {
                return OpenClawCronDueJobs.missingColumns(missingColumns);
            }
            List<String> selectedOptionalColumns = OPTIONAL_COLUMNS.stream()
                .filter(columns::contains)
                .toList();
            return OpenClawCronDueJobs.ready(queryJobs(connection, nowMs, lookaheadMs, Math.max(1, limit),
                selectedOptionalColumns));
        }
    }

    private void ensureSqliteDriverLoaded() {
        try {
            Class.forName(org.sqlite.JDBC.class.getName());
        }
        catch (ClassNotFoundException e) {
            throw new IllegalStateException("SQLite JDBC driver is unavailable", e);
        }
    }

    private void configureReadOnly(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("PRAGMA query_only = ON");
            statement.execute("PRAGMA busy_timeout = 1000");
        }
    }

    private boolean hasCronJobsTable(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")) {
            statement.setString(1, TABLE_NAME);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        }
    }

    private Set<String> loadColumns(Connection connection) throws SQLException {
        Set<String> columns = new HashSet<>();
        try (Statement statement = connection.createStatement();
            ResultSet resultSet = statement.executeQuery("PRAGMA table_info(cron_jobs)")) {
            while (resultSet.next()) {
                columns.add(resultSet.getString("name"));
            }
        }
        return columns;
    }

    private List<OpenClawCronDueJob> queryJobs(Connection connection, long nowMs, long lookaheadMs, int limit,
        List<String> optionalColumns) throws SQLException {
        List<String> selectColumns = new ArrayList<>();
        selectColumns.add("job_id");
        selectColumns.add("next_run_at_ms");
        selectColumns.addAll(optionalColumns);

        String sql = "SELECT " + String.join(", ", selectColumns)
            + " FROM cron_jobs WHERE enabled = 1 AND running_at_ms IS NULL AND next_run_at_ms IS NOT NULL"
            + " AND next_run_at_ms >= ? AND next_run_at_ms <= ? ORDER BY next_run_at_ms ASC LIMIT ?";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setLong(1, nowMs);
            statement.setLong(2, nowMs + Math.max(0L, lookaheadMs));
            statement.setInt(3, limit);
            try (ResultSet resultSet = statement.executeQuery()) {
                List<OpenClawCronDueJob> jobs = new ArrayList<>();
                while (resultSet.next()) {
                    jobs.add(new OpenClawCronDueJob(resultSet.getString("job_id"),
                        resultSet.getLong("next_run_at_ms"), readOptionalString(resultSet, optionalColumns, "agent_id"),
                        readOptionalString(resultSet, optionalColumns, "session_key"),
                        readOptionalString(resultSet, optionalColumns, "session_target"),
                        readOptionalString(resultSet, optionalColumns, "payload_kind")));
                }
                return jobs;
            }
        }
    }

    private String readOptionalString(ResultSet resultSet, List<String> optionalColumns, String column)
        throws SQLException {
        if (!optionalColumns.contains(column)) {
            return null;
        }
        return resultSet.getString(column);
    }
}
