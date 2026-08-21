package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import javax.sql.DataSource;
import jakarta.annotation.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.PlatformTransactionManager;

@SpringJUnitConfig(ConnectorConnectionStateServiceTransactionIntegrationTest.Config.class)
class ConnectorConnectionStateServiceTransactionIntegrationTest {
    private static final String USER = "1001";

    @Resource private ConnectorConnectionStateService service;
    @Resource private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        org.mockito.Mockito.reset(Config.manifest, Config.authMapper, Config.infoMapper, Config.userService, Config.cache);
        jdbc.execute("delete from credential_pair"); jdbc.execute("delete from binding_state");
        jdbc.update("insert into credential_pair values ('client','old-client'),('key','old-key')");
        jdbc.update("insert into binding_state values (1,'Y')");
        Users user = new Users(); user.setUserId(1001L); user.setUserCode("tester");
        when(Config.userService.findById(1001L)).thenReturn(user);
    }

    @Test
    void saveLateBindingFailureRollsBackAlreadyWrittenCredentialPairAndBinding() {
        when(Config.manifest.upsertAndEnable(eq(1001L), any(), any())).thenAnswer(invocation -> {
            jdbc.update("update credential_pair set val=? where name='client'", "new-client");
            jdbc.update("update credential_pair set val=? where name='key'", "new-key"); return true;
        });
        when(Config.authMapper.selectOne(any())).thenReturn(null);
        when(Config.authMapper.insertActiveIgnoreConflict(any())).thenAnswer(invocation -> {
            jdbc.update("insert into binding_state values (2,'Y')"); throw new IllegalStateException("late binding failure");
        });

        assertThatThrownBy(() -> service.saveEnabledCredentialAuthorization(USER, connector(), connected(), "id",
            java.util.Map.of("IMA_OPENAPI_CLIENTID", "new-client", "IMA_OPENAPI_APIKEY", "new-key")))
            .isInstanceOf(IllegalStateException.class);
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForList("select val from credential_pair order by name", String.class))
            .containsExactly("old-client", "old-key");
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject("select count(*) from binding_state", Integer.class)).isEqualTo(1);
        verify(Config.cache, never()).refreshPrivateParamCacheAfterCommit(any(), any());
    }

    @Test
    void revokeLateBindingFailureRestoresPhysicallyDeletedPairAndActiveBinding() {
        ConnectorAuth auth = new ConnectorAuth(); auth.setAuthId(1L); auth.setEnableFlag("Y"); auth.setStatusCd("00A");
        when(Config.authMapper.selectOne(any())).thenReturn(auth);
        when(Config.infoMapper.selectById(9L)).thenReturn(connector());
        when(Config.manifest.managedEnvironmentKeys(any())).thenReturn(
            java.util.List.of("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY"));
        when(Config.manifest.removeManagedCredentials(eq(1001L), any())).thenAnswer(invocation -> {
            jdbc.update("delete from credential_pair where name='client'"); jdbc.update("delete from credential_pair where name='key'"); return true;
        });
        when(Config.authMapper.updateById(any())).thenAnswer(invocation -> {
            jdbc.update("update binding_state set enabled='N' where id=1"); throw new IllegalStateException("late unlink failure");
        });

        assertThatThrownBy(() -> service.revokeAuthorization(USER, 9L)).isInstanceOf(IllegalStateException.class);
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject("select count(*) from credential_pair", Integer.class)).isEqualTo(2);
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject("select enabled from binding_state where id=1", String.class)).isEqualTo("Y");
        verify(Config.cache, never()).refreshPrivateParamCacheAfterCommit(any(), any());
    }

    private ConnectorInfo connector() { ConnectorInfo c = new ConnectorInfo(); c.setConnectorId(9L); c.setConnectorCode("ima-openapi"); c.setStatusCd("00A"); c.setAuthMode("AK_SK"); c.setProviderCode("ima-openapi"); return c; }
    private AuthorizationStatusResult connected() { return new AuthorizationStatusResult(AuthorizationStatus.CONNECTED, null, "IMA", null, null, null, null); }

    @Configuration @EnableTransactionManagement
    static class Config {
        static final ConnectorManifestService manifest = mock(ConnectorManifestService.class);
        static final ConnectorAuthMapper authMapper = mock(ConnectorAuthMapper.class);
        static final ConnectorInfoMapper infoMapper = mock(ConnectorInfoMapper.class);
        static final UserService userService = mock(UserService.class);
        static final UserPrivateParamApplicationService cache = mock(UserPrivateParamApplicationService.class);
        @Bean DataSource dataSource() { return new EmbeddedDatabaseBuilder().setType(EmbeddedDatabaseType.H2).build(); }
        @Bean JdbcTemplate jdbcTemplate(DataSource ds) { JdbcTemplate j = new JdbcTemplate(ds); j.execute("create table credential_pair(name varchar primary key,val varchar)"); j.execute("create table binding_state(id int primary key,enabled varchar)"); return j; }
        @Bean PlatformTransactionManager transactionManager(DataSource ds) { return new DataSourceTransactionManager(ds); }
        @Bean ConnectorConnectionStateService service() { return new ConnectorConnectionStateService(authMapper, infoMapper, mock(SequenceService.class), manifest, userService, cache); }
    }
}
