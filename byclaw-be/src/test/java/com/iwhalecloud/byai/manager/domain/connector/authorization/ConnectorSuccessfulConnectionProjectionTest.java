package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionalEventListenerFactory;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformPrivateFileSystemRouting;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer.CredentialProjectionSpec;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Simulated provider/persistence, real success-save and AFTER_COMMIT projection services. */
class ConnectorSuccessfulConnectionProjectionTest extends I18nTestSupport {
    @TempDir Path temporary;

    @Test
    void successfulConnectionProjectsOnlyAfterCommitThroughGenericPlatformFilesystem() throws Exception {
        runConnection(false);
    }

    @Test
    void rolledBackConnectionDoesNotProjectUserFile() throws Exception {
        runConnection(true);
    }

    private void runConnection(boolean rollback) throws Exception {
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        when(gateway.isRemote()).thenReturn(true);
        when(gateway.params(any(Object[].class))).thenCallRealMethod();
        AtomicReference<byte[]> projected = new AtomicReference<>();
        when(gateway.call(any(), any(), any())).thenAnswer(invocation -> {
            String operation = invocation.getArgument(1);
            Map<String, Object> params = invocation.getArgument(2);
            if ("write-atomic".equals(operation)) {
                assertThat(params.get("path")).isEqualTo("byclaw-user001/by/.connector-auth/.byclaw-e2e/success.json");
                projected.set(Base64.getDecoder().decode((String) params.get("content")));
            }
            return null;
        });
        simulateConnection(gateway, temporary.resolve("logical-platform-root"), 42L, "user001",
            "byclaw-user001", "/by/.connector-auth/.byclaw-e2e/success.json", rollback,
            () -> assertThat(projected.get()).isNull());
        if (rollback) {
            assertThat(projected.get()).isNull();
        } else {
            var json = new ObjectMapper().readTree(projected.get());
            assertThat(json.path("connectorCode").asText()).isEqualTo("byclaw-e2e-simulation");
            assertThat(json.path("accessToken").asText()).isEqualTo("SIMULATION-NOT-A-CREDENTIAL");
            assertThat(json.path("credentialReference").asText()).isEqualTo("simulation-reference");
            assertThat(json.path("schemaVersion").asInt()).isEqualTo(1);
        }
        assertThat(java.nio.file.Files.exists(temporary.resolve("logical-platform-root"))).isFalse();
    }

    static void simulateConnection(PlatformRemoteGateway gateway, Path root, Long userId, String userCode,
            String bucket, String projectionPath, boolean rollback, Runnable beforeCommit) {
        if (TableInfoHelper.getTableInfo(ConnectorAuth.class) == null) {
            TableInfoHelper.initTableInfo(new org.apache.ibatis.builder.MapperBuilderAssistant(
                new MybatisConfiguration(), ""), ConnectorAuth.class);
        }
        var auths = mock(ConnectorAuthMapper.class);
        var connectors = mock(ConnectorInfoMapper.class);
        var sequences = mock(SequenceService.class);
        var manifests = mock(ConnectorManifestService.class);
        var users = mock(UserService.class);
        var params = mock(UserPrivateParamApplicationService.class);
        var login = mock(LoginApplicationService.class);
        var buckets = mock(UserBucketNamingService.class);
        var secrets = mock(ConnectorCredentialSecretStore.class);
        AtomicReference<ConnectorAuth> saved = new AtomicReference<>();
        when(auths.selectOne(any())).thenAnswer(invocation -> saved.get());
        when(auths.insertActiveIgnoreConflict(any())).thenAnswer(invocation -> {
            saved.set(invocation.getArgument(0));
            return 1;
        });
        when(sequences.nextVal()).thenReturn(900000001L);
        Users user = new Users();
        user.setUserId(userId);
        user.setUserCode(userCode);
        when(users.findById(userId)).thenReturn(user);
        LoginInfo info = new LoginInfo();
        info.setUserCode(userCode);
        when(login.getLoginInfo(userId)).thenReturn(info);
        when(buckets.buildUserBucketName(userCode)).thenReturn(bucket);
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(900000002L);
        connector.setConnectorCode("byclaw-e2e-simulation");
        connector.setConnectorName("Isolated successful connection simulation");
        connector.setProviderCode("byclaw-e2e-simulation");
        connector.setAuthMode("OAUTH2");
        connector.setStatusCd("00A");
        when(connectors.selectById(connector.getConnectorId())).thenReturn(connector);
        when(manifests.credentialProjection(connector)).thenReturn(Optional.of(new CredentialProjectionSpec(projectionPath)));
        when(manifests.upsertAndEnable(userId, connector)).thenReturn(true);
        when(secrets.findActive(userId.toString(), connector.getConnectorId(), connector.getProviderCode()))
            .thenReturn(Optional.of(ConnectorCredentialSecret.restored("simulation-reference",
                connector.getProviderCode(), userId.toString(), connector.getConnectorId(),
                "SIMULATION-NOT-A-CREDENTIAL", null, "bearer", null, null, null)));
        var routing = new PlatformPrivateFileSystemRouting(gateway, root.toString());
        var workspace = new ConnectorCredentialWorkspaceService(login, buckets, root.resolve("be-local-unused").toString());
        ReflectionTestUtils.setField(workspace, "platformPrivateFiles", routing);
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(TransactionalEventListenerFactory.class);
            context.registerBean(PlatformPrivateFileSystemRouting.class, () -> routing);
            var state = new ConnectorConnectionStateService(auths, connectors, sequences, manifests, users, params, context);
            var projection = new ConnectorCredentialProjectionService(workspace, secrets, state, manifests,
                connectors, auths, new ObjectMapper());
            ReflectionTestUtils.setField(projection, "platformPrivateFiles", routing);
            context.registerBean("projection", ConnectorCredentialProjectionService.class, () -> projection);
            context.refresh();
            var transactions = new TransactionTemplate(new AbstractPlatformTransactionManager() {
                @Override protected Object doGetTransaction() { return new Object(); }
                @Override protected void doBegin(Object transaction, TransactionDefinition definition) { }
                @Override protected void doCommit(DefaultTransactionStatus status) { }
                @Override protected void doRollback(DefaultTransactionStatus status) { }
            });
            transactions.executeWithoutResult(status -> {
                var connected = new AuthorizationStatusResult(AuthorizationStatus.CONNECTED,
                    "simulation-account", "Simulated successful connection", null, "simulation-reference", null, null);
                ConnectorAuth binding = state.saveEnabledAuthorization(userId.toString(), connector, connected,
                    "simulation-authorization");
                assertThat(binding.getEnableFlag()).isEqualTo("Y");
                assertThat(binding.getUserId()).isEqualTo(userId.toString());
                beforeCommit.run();
                if (rollback) status.setRollbackOnly();
            });
        }
    }
}
