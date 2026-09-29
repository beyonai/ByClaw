package com.iwhalecloud.byai.manager.domain.tenant;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Platform administrator's bounded SQL workbench for an existing tenant database. */
@Service
public class TenantDatasourceService {
    private static final int MAX_ROWS = 500;
    private static final int MAX_PAGE = 10000;
    private static final int QUERY_TIMEOUT_SECONDS = 15;
    private static final Pattern DANGEROUS_SQL = Pattern.compile(
        "\\b(delete|drop|truncate|update|insert|alter|create|merge|grant|revoke|call|do|vacuum|reindex|refresh|copy|execute|exec|replace|into)\\b",
        Pattern.CASE_INSENSITIVE);

    private final TenantAdminTenantMapper tenantMapper;
    private final SsSandboxRecordMapper sandboxMapper;
    private final TenantCredentialCrypto credentialCrypto;
    private final String dbProbeHost;

    public TenantDatasourceService(TenantAdminTenantMapper tenantMapper, SsSandboxRecordMapper sandboxMapper,
                                   TenantCredentialCrypto credentialCrypto,
                                   @Value("${BYCLAW_TENANT_DB_PROBE_HOST:}") String dbProbeHost) {
        this.tenantMapper = tenantMapper;
        this.sandboxMapper = sandboxMapper;
        this.credentialCrypto = credentialCrypto;
        this.dbProbeHost = dbProbeHost;
    }

    public List<TableInfo> tables(long enterpriseId) {
        try (Connection connection = connect(enterpriseId);
             PreparedStatement statement = connection.prepareStatement(
                 "SELECT table_schema, table_name, table_type FROM information_schema.tables "
                     + "WHERE table_schema = 'byai' "
                     + "ORDER BY table_schema, table_name")) {
            statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
            List<TableInfo> tables = new ArrayList<>();
            try (ResultSet result = statement.executeQuery()) {
                while (result.next()) {
                    tables.add(new TableInfo(result.getString(1), result.getString(2), result.getString(3)));
                }
            }
            return tables;
        } catch (SQLException e) {
            throw databaseUnavailable(e);
        }
    }

    public QueryResult browse(long enterpriseId, String schema, String table, int page) {
        if (!"byai".equals(schema) || table == null || table.length() > 128
            || page < 1 || page > MAX_PAGE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid table selection");
        }
        try (Connection connection = connect(enterpriseId)) {
            try (PreparedStatement check = connection.prepareStatement(
                "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?")) {
                check.setString(1, schema);
                check.setString(2, table);
                if (!check.executeQuery().next()) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "table not found");
                }
            }
            String sql = "SELECT * FROM " + quoteIdentifier(schema) + "." + quoteIdentifier(table)
                + " LIMIT " + (MAX_ROWS + 1) + " OFFSET " + ((page - 1L) * MAX_ROWS);
            try (Statement statement = connection.createStatement()) {
                statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
                try (ResultSet result = statement.executeQuery(sql)) {
                    return toResult(result, 0, page, true);
                }
            }
        } catch (SQLException e) {
            throw databaseUnavailable(e);
        }
    }

    public QueryResult execute(long enterpriseId, String sql, int page, boolean confirmed) {
        String statementSql = singleStatement(sql);
        if (page < 1 || page > MAX_PAGE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid page");
        }
        boolean dangerous = requiresConfirmation(statementSql);
        if (dangerous && !confirmed) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SQL requires confirmation");
        }
        boolean pageable = !dangerous && pageableQuery(statementSql);
        if (page > 1 && !pageable) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "this SQL result cannot be paged");
        }
        String pagedSql = pageable ? pagedQuery(statementSql, page) : statementSql;
        try (Connection connection = connect(enterpriseId);
             Statement statement = connection.createStatement()) {
            connection.setReadOnly(!dangerous);
            statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
            statement.setMaxRows(MAX_ROWS + 1);
            boolean hasResult = statement.execute(pagedSql);
            if (hasResult) {
                try (ResultSet result = statement.getResultSet()) {
                    return toResult(result, 0, page, pageable);
                }
            }
            return new QueryResult(List.of(), List.of(), statement.getUpdateCount(), page, MAX_ROWS, false, false);
        } catch (SQLException e) {
            throw databaseUnavailable(e);
        }
    }

    private Connection connect(long enterpriseId) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
        if (enterpriseId <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
        String dbName = tenantMapper.selectConfig(enterpriseId, "DB_NAME");
        String dbUser = tenantMapper.selectConfig(enterpriseId, "DB_USER");
        String envelope = tenantMapper.selectConfig(enterpriseId, "DB_PASSWORD");
        String recordId = tenantMapper.selectConfig(enterpriseId, "DB_SANDBOX_RECORD_ID");
        if (!("byclaw_t_" + enterpriseId).equals(dbName)
            || !("bc_t_" + enterpriseId + "_admin").equals(dbUser)
            || envelope == null || recordId == null || !recordId.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant database is not provisioned");
        }
        SsSandboxRecord record = sandboxMapper.selectById(Long.parseLong(recordId));
        if (record == null || !Long.valueOf(enterpriseId).equals(record.getEnterpriseId())
            || !"TENANT".equals(record.getOwnerScope())
            || !"tenant-opengauss".equals(record.getSandboxType())
            || !"RUNNING".equals(record.getStatus())
            || record.getEndpoint() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant database sandbox is not running");
        }
        URI endpoint;
        try {
            endpoint = URI.create(record.getEndpoint());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant database endpoint is invalid");
        }
        if (!"tcp".equals(endpoint.getScheme()) || endpoint.getHost() == null
            || endpoint.getPort() < 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant database endpoint is invalid");
        }
        String host = dbProbeHost == null || dbProbeHost.isBlank() ? endpoint.getHost() : dbProbeHost;
        String url = "jdbc:postgresql://" + host + ":" + endpoint.getPort() + "/" + dbName
            + "?connectTimeout=5&socketTimeout=20";
        try {
            return DriverManager.getConnection(url, dbUser,
                credentialCrypto.decrypt(enterpriseId, dbName, envelope));
        } catch (GeneralSecurityException | SQLException e) {
            throw databaseUnavailable(e);
        }
    }

    private static String quoteIdentifier(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }

    /** Allow one SQL statement, including a trailing semicolon; quoted text is not a delimiter. */
    static String singleStatement(String sql) {
        if (sql == null || sql.isBlank() || sql.length() > 20000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SQL must be between 1 and 20000 characters");
        }
        String value = sql.trim();
        boolean single = false;
        boolean doubleQuoted = false;
        int terminator = -1;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\'' && !doubleQuoted) {
                if (single && i + 1 < value.length() && value.charAt(i + 1) == '\'') i++;
                else single = !single;
            } else if (c == '"' && !single) {
                if (doubleQuoted && i + 1 < value.length() && value.charAt(i + 1) == '"') i++;
                else doubleQuoted = !doubleQuoted;
            } else if (c == ';' && !single && !doubleQuoted) {
                if (terminator >= 0) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "run one SQL statement at a time");
                }
                terminator = i;
            }
        }
        if (single || doubleQuoted || (terminator >= 0 && !value.substring(terminator + 1).isBlank())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "run one SQL statement at a time");
        }
        return terminator >= 0 ? value.substring(0, terminator).trim() : value;
    }

    static boolean requiresConfirmation(String sql) {
        String visible = visibleSql(sql).stripLeading().toLowerCase(Locale.ROOT);
        return DANGEROUS_SQL.matcher(visible).find()
            || !visible.matches("(?s)^(select|with|values|show|explain)\\b.*");
    }

    private static boolean pageableQuery(String sql) {
        return visibleSql(sql).stripLeading().toLowerCase(Locale.ROOT)
            .matches("(?s)^(select|with|values)\\b.*");
    }

    static String pagedQuery(String sql, int page) {
        return "SELECT * FROM (" + sql + ") tenant_query_page LIMIT " + (MAX_ROWS + 1)
            + " OFFSET " + ((page - 1L) * MAX_ROWS);
    }

    /** Ignore SQL comments, quoted identifiers and values before classifying a statement. */
    private static String visibleSql(String sql) {
        StringBuilder visible = new StringBuilder(sql.length());
        String dollarTag = null;
        int mode = 0; // 0 = SQL, 1 = string, 2 = identifier, 3 = line comment, 4 = block comment, 5 = dollar string
        int blockDepth = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            char next = i + 1 < sql.length() ? sql.charAt(i + 1) : '\0';
            if (mode == 0) {
                if (c == '\'' || c == '"') {
                    mode = c == '\'' ? 1 : 2;
                } else if (c == '-' && next == '-') {
                    mode = 3;
                    i++;
                    visible.append(' ');
                } else if (c == '/' && next == '*') {
                    mode = 4;
                    blockDepth = 1;
                    i++;
                    visible.append(' ');
                } else if (c == '$') {
                    int end = sql.indexOf('$', i + 1);
                    String tag = end < 0 ? "" : sql.substring(i + 1, end);
                    if (end >= 0 && tag.matches("[A-Za-z_][A-Za-z_0-9]*|")) {
                        dollarTag = sql.substring(i, end + 1);
                        mode = 5;
                        i = end;
                    } else {
                        visible.append(c);
                        continue;
                    }
                } else {
                    visible.append(c);
                    continue;
                }
            } else if (mode == 1 || mode == 2) {
                char delimiter = mode == 1 ? '\'' : '"';
                if (c == delimiter) {
                    if (next == delimiter) {
                        i++;
                    } else {
                        mode = 0;
                    }
                }
            } else if (mode == 3) {
                if (c == '\r' || c == '\n') mode = 0;
            } else if (mode == 4) {
                if (c == '/' && next == '*') {
                    blockDepth++;
                    i++;
                } else if (c == '*' && next == '/') {
                    blockDepth--;
                    i++;
                    if (blockDepth == 0) mode = 0;
                }
            } else if (mode == 5 && sql.startsWith(dollarTag, i)) {
                i += dollarTag.length() - 1;
                mode = 0;
            }
            visible.append(' ');
        }
        return visible.toString();
    }

    static QueryResult toResult(ResultSet result, int affectedRows, int page, boolean pageable)
        throws SQLException {
        ResultSetMetaData metadata = result.getMetaData();
        List<ColumnInfo> columns = new ArrayList<>();
        for (int i = 1; i <= metadata.getColumnCount(); i++) {
            columns.add(new ColumnInfo(metadata.getColumnLabel(i), metadata.getColumnTypeName(i)));
        }
        List<List<String>> rows = new ArrayList<>();
        while (rows.size() < MAX_ROWS && result.next()) {
            List<String> row = new ArrayList<>();
            for (int i = 1; i <= metadata.getColumnCount(); i++) row.add(result.getString(i));
            rows.add(row);
        }
        boolean moreRows = result.next();
        return new QueryResult(columns, rows, affectedRows, page, MAX_ROWS,
            pageable && moreRows, !pageable && moreRows);
    }

    private static ResponseStatusException databaseUnavailable(Exception cause) {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY, "tenant database query failed", cause);
    }

    public record TableInfo(String schema, String name, String type) {}
    public record ColumnInfo(String name, String type) {}
    public record QueryResult(List<ColumnInfo> columns, List<List<String>> rows, int affectedRows,
                              int page, int pageSize, boolean hasNextPage, boolean truncated) {}
}
