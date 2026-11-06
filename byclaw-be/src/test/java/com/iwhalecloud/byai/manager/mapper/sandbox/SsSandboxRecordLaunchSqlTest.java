package com.iwhalecloud.byai.manager.mapper.sandbox;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.ParameterMapping;
import org.apache.ibatis.reflection.ParamNameResolver;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.type.JdbcType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class SsSandboxRecordLaunchSqlTest {

    private static final String LAUNCH_UPDATE = "status = 'RUNNING', sandbox_id = ?, endpoint = ?, gateway_token = ?, "
        + "timeout_seconds = ?, remote_expires_at = ?, last_renew_at = ?, next_renew_at = ?, last_access_time = ?, "
        + "update_time = ?, version = version + 1, lock_version = lock_version + 1 "
        + "WHERE id = ? AND status = 'STARTING' AND lock_version = ?";

    private static final List<String> LAUNCH_PARAMETERS = List.of("sandboxId", "endpoint", "gatewayToken",
        "timeoutSeconds", "remoteExpiresAt", "lastRenewAt", "nextRenewAt", "lastAccessTime", "lastAccessTime",
        "id", "lockVersion");

    @Test
    void existingLaunchEntryDoesNotReadOrWriteInstanceContext() throws Exception {
        BoundSql boundSql = boundSql("updateLaunchSuccess", null);

        assertThat(normalize(boundSql)).isEqualTo("UPDATE ss_sandbox_record SET " + LAUNCH_UPDATE);
        assertThat(boundSql.getParameterMappings()).extracting(ParameterMapping::getProperty)
            .containsExactlyElementsOf(LAUNCH_PARAMETERS);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = "{\"version\":1}")
    void contextualLaunchWritesSnapshotInTheSameCompareAndSet(String snapshot) throws Exception {
        BoundSql boundSql = boundSql("updateLaunchSuccessWithContext", snapshot);

        assertThat(normalize(boundSql)).isEqualTo(
            "UPDATE ss_sandbox_record SET instance_context_snapshot = ?, " + LAUNCH_UPDATE);
        List<String> parameters = new ArrayList<>();
        parameters.add("instanceContextSnapshot");
        parameters.addAll(LAUNCH_PARAMETERS);
        assertThat(boundSql.getParameterMappings()).extracting(ParameterMapping::getProperty)
            .containsExactlyElementsOf(parameters);
        assertThat(boundSql.getParameterMappings().get(0).getJdbcType()).isEqualTo(JdbcType.VARCHAR);
    }

    private BoundSql boundSql(String statement, String snapshot) throws Exception {
        String resource = "com/iwhalecloud/byai/manager/mapper/sandbox/SsSandboxRecordMapper.xml";
        Configuration configuration = new Configuration();
        try (var input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        var method = Arrays.stream(SsSandboxRecordMapper.class.getMethods())
            .filter(candidate -> candidate.getName().equals(statement)).findFirst().orElseThrow();
        Date now = new Date(123456789L);
        Object[] arguments = {7L, "sandbox-1", "http://sandbox", "gateway-token", 300, now, now, now, now, 2};
        if (method.getParameterCount() == 11) {
            arguments = Arrays.copyOf(arguments, 11);
            arguments[10] = snapshot;
        }
        Object parameters = new ParamNameResolver(configuration, method).getNamedParams(arguments);
        BoundSql boundSql = configuration.getMappedStatement(SsSandboxRecordMapper.class.getName() + "." + statement)
            .getBoundSql(parameters);
        var parameterValues = configuration.newMetaObject(parameters);
        for (ParameterMapping mapping : boundSql.getParameterMappings()) {
            assertThat(parameterValues.hasGetter(mapping.getProperty())).isTrue();
        }
        return boundSql;
    }

    private String normalize(BoundSql boundSql) {
        return boundSql.getSql().replaceAll("\\s+", " ").trim();
    }
}
