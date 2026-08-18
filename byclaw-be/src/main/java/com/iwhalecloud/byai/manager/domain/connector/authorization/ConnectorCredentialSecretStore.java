package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorCredentialSecretEntity;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorCredentialSecretMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;

@Service
public class ConnectorCredentialSecretStore {
    private final ConnectorCredentialSecretMapper mapper;
    private final SequenceService sequenceService;

    public ConnectorCredentialSecretStore(ConnectorCredentialSecretMapper mapper, SequenceService sequenceService) {
        this.mapper = mapper;
        this.sequenceService = sequenceService;
    }

    @Transactional(rollbackFor = Exception.class)
    public String save(ConnectorCredentialSecret secret) {
        if (secret == null || !StringUtils.hasText(secret.accessToken())) {
            throw new IllegalArgumentException("OAuth2 access token不能为空");
        }
        mapper.update(null, new UpdateWrapper<ConnectorCredentialSecretEntity>()
            .eq("user_id", secret.userId())
            .eq("connector_id", secret.connectorId())
            .eq("provider_code", secret.providerCode())
            .eq("status_cd", "00A")
            .set("status_cd", "00X")
            .set("update_time", new Date()));
        ConnectorCredentialSecretEntity row = new ConnectorCredentialSecretEntity();
        row.setCredentialId(sequenceService.nextVal());
        row.setCredentialReference(secret.credentialReference());
        row.setProviderCode(secret.providerCode());
        row.setUserId(secret.userId());
        row.setConnectorId(secret.connectorId());
        row.setAccessTokenCipher(Sm4Util.encrypt(secret.accessToken()));
        if (StringUtils.hasText(secret.refreshToken())) {
            row.setRefreshTokenCipher(Sm4Util.encrypt(secret.refreshToken()));
        }
        row.setTokenType(secret.tokenType());
        row.setGrantedScopes(secret.grantedScopes());
        row.setAccessExpireTime(secret.accessExpiresAt());
        row.setRefreshExpireTime(secret.refreshExpiresAt());
        row.setStatusCd("00A");
        row.setCreateTime(new Date());
        if (mapper.insert(row) != 1) {
            throw new IllegalStateException("OAuth2凭证保存失败");
        }
        return row.getCredentialReference();
    }

    public Optional<ConnectorCredentialSecret> findActive(String userId, Long connectorId, String providerCode) {
        ConnectorCredentialSecretEntity row = mapper.selectOne(new QueryWrapper<ConnectorCredentialSecretEntity>()
            .eq("user_id", userId)
            .eq("connector_id", connectorId)
            .eq("provider_code", providerCode)
            .eq("status_cd", "00A")
            .orderByDesc("create_time")
            .last("LIMIT 1"));
        if (row == null) {
            return Optional.empty();
        }
        return Optional.of(ConnectorCredentialSecret.restored(row.getCredentialReference(), row.getProviderCode(),
            row.getUserId(), row.getConnectorId(), Sm4Util.decrypt(row.getAccessTokenCipher()),
            StringUtils.hasText(row.getRefreshTokenCipher()) ? Sm4Util.decrypt(row.getRefreshTokenCipher()) : null,
            row.getTokenType(), row.getGrantedScopes(), row.getAccessExpireTime(), row.getRefreshExpireTime()));
    }

    public void revoke(String credentialReference) {
        int updated = mapper.update(null, new UpdateWrapper<ConnectorCredentialSecretEntity>()
            .eq("credential_reference", credentialReference)
            .eq("status_cd", "00A")
            .set("status_cd", "00X")
            .set("update_time", new Date()));
        if (updated != 1) {
            throw new IllegalStateException("OAuth2凭证撤销失败");
        }
    }
}
