package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Set;
import java.util.Date;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MailPrivateParamStoreTest {
    private final UserPrivateParamMapper mapper = mock(UserPrivateParamMapper.class);
    private final ObjectMapper json = new ObjectMapper();
    private final MailPrivateParamStore store = new MailPrivateParamStore(mapper, json);

    @BeforeEach
    void metadata() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), "test"), UserPrivateParam.class);
    }

    @Test
    void connectorIdentityComesFromPrivateRowAndRevocationRemovesSecrets() {
        var row = row("NORMAL");
        when(mapper.selectList(any())).thenReturn(List.of(row));
        assertThat(store.snapshot(42L)).singleElement().satisfies(account -> {
            assertThat(account.getAccountId()).isEqualTo(11L);
            assertThat(account.getUserId()).isEqualTo(42L);
            assertThat(account.getEmail()).isEqualTo("test@qq.com");
        });
        row.setStatus("DISABLED");
        row.setParamValueCipher("");
        assertThat(store.snapshot(42L)).singleElement().satisfies(account -> {
            assertThat(account.getDeleteFlag()).isEqualTo("1");
            assertThat(account.getAuthCodeCipher()).isNull();
        });
    }

    @Test
    void failedProjectionRecoversWithoutUsingShortDatabaseStatusColumn() throws Exception {
        var row = row("NORMAL");
        when(mapper.selectList(any())).thenReturn(List.of(row));
        when(mapper.update(isNull(), any())).thenAnswer(call -> {
            LambdaUpdateWrapper<UserPrivateParam> update = call.getArgument(1);
            // Model the external database write while exercising real encryption and serialization.
            for (Object value : update.getParamNameValuePairs().values()) {
                if (!(value instanceof String candidate) || candidate.equals(row.getParamValueCipher())) continue;
                try {
                    if (Sm4Util.decrypt(candidate).startsWith("{")) row.setParamValueCipher(candidate);
                } catch (RuntimeException ignored) { }
            }
            return 1;
        });
        store.projectionStatus(42L, Set.of(11L), true);
        assertThat(store.snapshot(42L)).singleElement()
            .extracting(UserMailAccount::getStatus).isEqualTo("PROJECTION_FAILED");
        assertThat(row.getStatus()).isEqualTo("NORMAL");
        store.projectionStatus(42L, Set.of(11L), false);
        assertThat(store.snapshot(42L)).singleElement()
            .extracting(UserMailAccount::getStatus).isEqualTo("NORMAL");
    }

    @Test
    void revokedTombstoneIsRetriedButNeverSerializedAsAnActiveAccount() {
        var row = row("DISABLED");
        row.setParamValueCipher("");
        when(mapper.selectList(any())).thenReturn(List.of(row));
        var state = new MailAccountProjectionStateService(store,
            mock(com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper.class),
            mock(com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService.class),
            mock(com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore.class), json);
        assertThat(state.loadActiveSnapshot(42L)).isEmpty();
        assertThat(state.loadAllAccountIds(42L)).containsExactly(11L);
    }

    @Test
    void savesEncryptedConfigurationAndReusesOneParameterPerConnector() throws Exception {
        var existing = row("NORMAL");
        when(mapper.selectList(any())).thenReturn(List.of(existing));
        when(mapper.selectOne(any())).thenReturn(existing);
        when(mapper.updateById(any())).thenReturn(1);
        var account = store.find(42L, 11L);
        account.setEmail("replacement@qq.com");

        store.save(account);

        var saved = org.mockito.ArgumentCaptor.forClass(UserPrivateParam.class);
        org.mockito.Mockito.verify(mapper).updateById(saved.capture());
        assertThat(saved.getValue().getParamId()).isEqualTo(100L);
        assertThat(saved.getValue().getParamKey()).isEqualTo("MAIL_CONNECTOR_11");
        assertThat(saved.getValue().getParamValueCipher()).doesNotContain("replacement@qq.com", "test-secret");
        assertThat(json.readTree(Sm4Util.decrypt(saved.getValue().getParamValueCipher())).path("email").asText())
            .isEqualTo("replacement@qq.com");
    }

    @Test
    void saveRejectsParameterOwnedBySomeoneElse() {
        var conflicting = row("NORMAL");
        conflicting.setParamSource("USER");
        when(mapper.selectOne(any())).thenReturn(conflicting);
        var account = new UserMailAccount();
        account.setUserId(42L);
        account.setConnectorId(11L);
        account.setProviderCode("qq");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.save(account))
            .isInstanceOf(IllegalArgumentException.class);
        org.mockito.Mockito.verify(mapper, org.mockito.Mockito.never()).updateById(any());
    }

    @Test
    void connectionCheckCannotOverwriteRevocationOrNewerConfiguration() {
        var row = row("NORMAL");
        when(mapper.selectList(any())).thenReturn(List.of(row));
        var account = store.find(42L, 11L);
        Date observed = row.getUpdateTime();
        row.setUpdateTime(new Date(observed.getTime() + 1000));
        assertThat(store.updateCheck(account, "PENDING", observed)).isFalse();
        row.setStatus("DISABLED");
        assertThat(store.updateCheck(account, "PENDING", row.getUpdateTime())).isFalse();
        org.mockito.Mockito.verify(mapper, org.mockito.Mockito.never()).update(isNull(), any());
    }

    @Test
    void nullTimestampCheckStillUsesCipherAndOwnerCompareAndSet() {
        var row = row("NORMAL");
        row.setUpdateTime(null);
        when(mapper.selectList(any())).thenReturn(List.of(row));
        when(mapper.update(isNull(), any())).thenReturn(1);
        var account = store.find(42L, 11L);
        account.setStatus("NORMAL");
        assertThat(store.updateCheck(account, "PENDING", null)).isTrue();
        var update = org.mockito.ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        org.mockito.Mockito.verify(mapper).update(isNull(), update.capture());
        assertThat(update.getValue().getSqlSegment())
            .contains("user_id", "param_id", "param_value_cipher", "update_time IS NULL", "status");
    }

    @Test
    void oauthConfigurationUsesConnectorIdentityAndRejectsMissingMailboxIdentity() throws Exception {
        when(mapper.selectList(any())).thenReturn(List.of());
        var connector = new com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo();
        connector.setConnectorId(21L);
        connector.setConnectorCode("gmail-mail");
        connector.setProviderCode("gmail-oauth2");
        var result = new com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult(
            com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus.CONNECTED,
            "subject-id", "test@gmail.com", null, "credential-ref", null, null);
        var config = json.readTree(store.oauthConfiguration(42L, connector, result));
        assertThat(config.path("accountId").asLong()).isEqualTo(21L);
        assertThat(config.path("email").asText()).isEqualTo("test@gmail.com");
        assertThat(config.path("credentialRef").asText()).isEqualTo("credential-ref");
        assertThat(config.path("status").asText()).isEqualTo("PENDING");
        var invalid = new com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult(
            com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus.CONNECTED,
            "subject-id", "Display Name", null, "credential-ref", null, null);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.oauthConfiguration(42L, connector, invalid))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void successfulFileProjectionDoesNotEraseConnectionProbeFailures() throws Exception {
        var row = row("NORMAL");
        var account = json.readValue(Sm4Util.decrypt(row.getParamValueCipher()), UserMailAccount.class);
        account.setStatus("AUTH_REQUIRED");
        row.setParamValueCipher(Sm4Util.encrypt(store.encode(account)));
        when(mapper.selectList(any())).thenReturn(List.of(row));
        store.projectionStatus(42L, Set.of(11L), false);
        org.mockito.Mockito.verify(mapper, org.mockito.Mockito.never()).update(isNull(), any());
        assertThat(store.find(42L, 11L).getStatus()).isEqualTo("AUTH_REQUIRED");
    }

    private UserPrivateParam row(String status) {
        UserMailAccount account = new UserMailAccount();
        account.setEmail("test@qq.com");
        account.setAuthType("APP_PASSWORD");
        account.setAuthCodeCipher(Sm4Util.encrypt("test-secret"));
        account.setStatus("PENDING");
        account.setUserId(999L); // Serialized identity must not override the owner.
        UserPrivateParam row = new UserPrivateParam();
        row.setParamId(100L);
        row.setUserId(42L);
        row.setParamKey("MAIL_CONNECTOR_11");
        row.setParamSource("CONNECTOR");
        row.setSourceRef("qq-mail");
        row.setStatus(status);
        row.setDeleteFlag("0");
        row.setUpdateTime(new Date());
        row.setParamValueCipher(Sm4Util.encrypt(store.encode(account)));
        return row;
    }
}
