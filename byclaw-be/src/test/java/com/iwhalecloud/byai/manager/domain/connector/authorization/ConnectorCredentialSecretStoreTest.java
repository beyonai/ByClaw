package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.util.Date;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorCredentialSecretEntity;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorCredentialSecretMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class ConnectorCredentialSecretStoreTest {

    @Test
    void referenceLookupUsesReferenceOwnerAndActiveStatus() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        ConnectorCredentialSecretEntity row = new ConnectorCredentialSecretEntity();
        row.setCredentialReference("owned-ref");
        row.setProviderCode("google");
        row.setUserId("1001");
        row.setConnectorId(9L);
        row.setAccessTokenCipher(Sm4Util.encrypt("access"));
        when(mapper.selectOne(any())).thenReturn(row);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, mock(SequenceService.class));

        assertThat(store.findActiveByReference("owned-ref", "1001")).get()
            .extracting(ConnectorCredentialSecret::accessToken).isEqualTo("access");

        var query = ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.query.QueryWrapper.class);
        verify(mapper).selectOne(query.capture());
        assertThat(query.getValue().getSqlSegment())
            .contains("credential_reference", "user_id", "status_cd");
    }

    @Test
    void storesOnlyCiphertextAndReturnsOpaqueReference() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        SequenceService sequenceService = mock(SequenceService.class);
        when(sequenceService.nextVal()).thenReturn(701L);
        when(mapper.insert(any())).thenReturn(1);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, sequenceService);

        Date accessExpiry = new Date(1_000L);
        Date refreshExpiry = new Date(2_000L);
        String reference = store.save(ConnectorCredentialSecret.forOAuth2(
            "github-oauth2", "1001", 1003L, "access-token", "refresh-token",
            "bearer", "read:user repo", accessExpiry, refreshExpiry
        ));

        ArgumentCaptor<ConnectorCredentialSecretEntity> captor =
            ArgumentCaptor.forClass(ConnectorCredentialSecretEntity.class);
        verify(mapper).insert(captor.capture());
        ConnectorCredentialSecretEntity row = captor.getValue();
        verify(mapper).update(org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        assertThat(reference).isEqualTo(row.getCredentialReference());
        assertThat(row.getAccessTokenCipher()).doesNotContain("access-token");
        assertThat(row.getRefreshTokenCipher()).doesNotContain("refresh-token");
        assertThat(Sm4Util.decrypt(row.getAccessTokenCipher())).isEqualTo("access-token");
        assertThat(Sm4Util.decrypt(row.getRefreshTokenCipher())).isEqualTo("refresh-token");
        assertThat(row.getTokenType()).isEqualTo("bearer");
        assertThat(row.getGrantedScopes()).isEqualTo("read:user repo");
        assertThat(row.getAccessExpireTime()).isEqualTo(accessExpiry);
        assertThat(row.getRefreshExpireTime()).isEqualTo(refreshExpiry);
    }

    @Test
    void loadsAndDecryptsActiveCredentialMetadata() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        ConnectorCredentialSecretEntity row = new ConnectorCredentialSecretEntity();
        row.setCredentialReference("credential-ref");
        row.setProviderCode("github-oauth2");
        row.setUserId("1001");
        row.setConnectorId(1003L);
        row.setAccessTokenCipher(Sm4Util.encrypt("access-token"));
        row.setRefreshTokenCipher(Sm4Util.encrypt("refresh-token"));
        row.setTokenType("bearer");
        row.setGrantedScopes("read:user repo");
        row.setAccessExpireTime(new Date(1_000L));
        row.setRefreshExpireTime(new Date(2_000L));
        when(mapper.selectOne(any())).thenReturn(row);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(
            mapper, mock(SequenceService.class));

        ConnectorCredentialSecret secret = store.findActive("1001", 1003L, "github-oauth2").orElseThrow();

        assertThat(secret.accessToken()).isEqualTo("access-token");
        assertThat(secret.refreshToken()).isEqualTo("refresh-token");
        assertThat(secret.tokenType()).isEqualTo("bearer");
        assertThat(secret.grantedScopes()).isEqualTo("read:user repo");
        assertThat(secret.accessExpiresAt()).isEqualTo(new Date(1_000L));
        assertThat(secret.refreshExpiresAt()).isEqualTo(new Date(2_000L));
    }

    @Test
    void revokeSoftDeletesExactlyOneActiveCredential() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        when(mapper.update(org.mockito.ArgumentMatchers.isNull(), any())).thenReturn(1);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(
            mapper, mock(SequenceService.class));

        store.revoke("credential-ref");

        verify(mapper).update(org.mockito.ArgumentMatchers.isNull(), any());
    }

    @Test
    void replaceRotatesEncryptedTokensWithoutChangingReference() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        when(mapper.update(org.mockito.ArgumentMatchers.isNull(), any())).thenReturn(1);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, mock(SequenceService.class));
        ConnectorCredentialSecret replacement = ConnectorCredentialSecret.restored(
            "credential-ref", "gmail-oauth2", "1001", 1003L, "new-access", "new-refresh",
            "Bearer", "openid email", new Date(3_000L), new Date(4_000L));

        String reference = store.replace("credential-ref", new Date(1_000L), replacement);

        assertThat(reference).isEqualTo("credential-ref");
        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<ConnectorCredentialSecretEntity>>
            captor = ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper.class);
        verify(mapper).update(org.mockito.ArgumentMatchers.isNull(), captor.capture());
        String sql = captor.getValue().getSqlSet();
        assertThat(sql).contains("access_token_cipher", "refresh_token_cipher", "access_expire_time",
            "refresh_expire_time", "update_time");
        assertThat(sql).doesNotContain("credential_reference=");
    }

    @Test
    void replaceRejectsMissingActiveCredentialAndDoesNotGuessRefreshToken() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        when(mapper.update(org.mockito.ArgumentMatchers.isNull(), any())).thenReturn(0);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, mock(SequenceService.class));
        ConnectorCredentialSecret replacement = ConnectorCredentialSecret.restored(
            "credential-ref", "gmail-oauth2", "1001", 1003L, "new-access", null,
            "Bearer", "openid email", new Date(), null);

        assertThatThrownBy(() -> store.replace("credential-ref", new Date(1_000L), replacement))
            .isInstanceOf(ConnectorCredentialRenewalConflictException.class);
    }

    @Test
    void replaceRejectsIncompleteOwnershipKeyBeforeUpdating() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, mock(SequenceService.class));
        ConnectorCredentialSecret replacement = ConnectorCredentialSecret.restored(
            "credential-ref", "gmail-oauth2", null, 1003L, "new-access", "refresh",
            "Bearer", "openid email", new Date(), null);

        assertThatThrownBy(() -> store.replace("credential-ref", new Date(1_000L), replacement))
            .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(mapper);
    }

    @Test
    void replaceUsesOldAccessExpiryAsCompareAndSwapVersion() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        when(mapper.update(org.mockito.ArgumentMatchers.isNull(), any())).thenReturn(1, 0);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, mock(SequenceService.class));
        Date oldExpiry = new Date(1_000L);
        ConnectorCredentialSecret replacement = ConnectorCredentialSecret.restored("ref", "gmail-oauth2",
            "1001", 9L, "new", "refresh", "Bearer", "scope", new Date(2_000L), null);

        store.replace("ref", oldExpiry, replacement);
        assertThatThrownBy(() -> store.replace("ref", oldExpiry, replacement))
            .isInstanceOf(ConnectorCredentialRenewalConflictException.class);
        var updates = ArgumentCaptor.forClass(
            com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper.class);
        verify(mapper, org.mockito.Mockito.times(2)).update(org.mockito.ArgumentMatchers.isNull(), updates.capture());
        assertThat(updates.getAllValues().get(0).getSqlSegment()).contains("access_expire_time");
    }

    @Test
    void replaceUsesIsNullCompareAndSwapForNonExpiringAccessToken() {
        ConnectorCredentialSecretMapper mapper = mock(ConnectorCredentialSecretMapper.class);
        when(mapper.update(org.mockito.ArgumentMatchers.isNull(), any())).thenReturn(1);
        ConnectorCredentialSecretStore store = new ConnectorCredentialSecretStore(mapper, mock(SequenceService.class));
        ConnectorCredentialSecret replacement = ConnectorCredentialSecret.restored("ref", "gmail-oauth2",
            "1001", 9L, "new", "refresh", "Bearer", "scope", new Date(2_000L), null);

        store.replace("ref", null, replacement);

        var update = ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper.class);
        verify(mapper).update(org.mockito.ArgumentMatchers.isNull(), update.capture());
        assertThat(update.getValue().getSqlSegment()).contains("access_expire_time IS NULL");
    }
}
