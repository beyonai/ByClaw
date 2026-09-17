package com.iwhalecloud.byai.manager.domain.mail;

import java.io.IOException;
import java.net.IDN;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;

/** Owns all post-commit mail projection database reads and writes in independent transactions. */
@Service
public class MailAccountProjectionStateService implements MailConnectorLookup {
    private final MailPrivateParamStore privateParamStore;
    private final ConnectorInfoMapper connectorInfoMapper;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorCredentialSecretStore secretStore;
    private final ObjectMapper objectMapper;

    public MailAccountProjectionStateService(MailPrivateParamStore privateParamStore,
            ConnectorInfoMapper connectorInfoMapper, ConnectorConnectionStateService connectionStateService,
            ConnectorCredentialSecretStore secretStore, ObjectMapper objectMapper) {
        this.privateParamStore = privateParamStore;
        this.connectorInfoMapper = connectorInfoMapper;
        this.connectionStateService = connectionStateService;
        this.secretStore = secretStore;
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public List<UserMailAccount> loadActiveSnapshot(Long userId) {
        return privateParamStore.active(userId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Set<Long> reconcileCurrentBindings(Long userId) {
        Set<Long> affected = new LinkedHashSet<>();
        for (MailProviderVO provider : MailProviderCatalog.list()) {
            if (!"OAUTH2".equals(provider.getAuthType())) continue;
            affected.addAll(reconcileProvider(userId, provider, activeConnector(provider.getConnectorCode())));
        }
        return affected;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Set<Long> reconcileCurrentBinding(Long userId, Long connectorId) {
        ConnectorInfo connector = connectorById(connectorId);
        if (connector == null) return Set.of();
        MailProviderVO provider = MailProviderCatalog.findByConnectorCode(connector.getConnectorCode()).orElse(null);
        if (provider == null) return Set.of();
        if (!"OAUTH2".equals(provider.getAuthType())) {
            return privateParamStore.ids(userId).contains(connectorId) ? Set.of(connectorId) : Set.of();
        }
        return reconcileProvider(userId, provider, connector);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> loadAccountIdsForConnector(Long userId, Long connectorId) {
        return privateParamStore.ids(userId).contains(connectorId) ? Set.of(connectorId) : Set.of();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public boolean recognizesMailConnector(Long connectorId) {
        ConnectorInfo connector = connectorInfoMapper.selectById(connectorId);
        return connector != null && MailProviderCatalog.findByConnectorCode(connector.getConnectorCode()).isPresent();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public String connectorCode(Long connectorId) {
        ConnectorInfo connector = connectorInfoMapper.selectById(connectorId);
        return connector == null ? null : connector.getConnectorCode();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> invalidProjectionIds(Long userId) {
        return privateParamStore.invalidProjectionIds(userId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public String storedConnectorCode(Long userId, Long connectorId) {
        return privateParamStore.connectorCode(userId, connectorId);
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public ConnectorInfo findActiveConnector(String connectorCode) {
        return activeConnector(connectorCode);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markProjectionFailed(Long userId, Set<Long> accountIds) {
        privateParamStore.projectionStatus(userId, safeIds(accountIds), true);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Set<Long> markProjectionSucceeded(Long userId, Set<Long> accountIds) {
        return privateParamStore.projectionStatus(userId, safeIds(accountIds), false);
    }

    /** Read-only preparation used inside the mail account save transaction. */
    public void prepareOAuthBinding(UserMailAccount account) {
        if (account == null || !"OAUTH2".equals(account.getAuthType())) return;
        MailProviderVO provider = MailProviderCatalog.require(account.getProviderCode());
        String reference = validAuthorizationReference(account.getUserId(), activeConnector(provider.getConnectorCode()),
            account.getEmail());
        account.setCredentialRef(reference);
        account.setStatus(reference == null ? "AUTH_REQUIRED" : "NORMAL");
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public ProjectionUserBatch scanProjectionUsersAfter(long afterAccountId, int limit) {
        return privateParamStore.scan(afterAccountId, limit);
    }

    public record ProjectionUserBatch(Set<Long> userIds, long nextAccountId, boolean hasMore) { }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> loadAllAccountIds(Long userId) {
        return privateParamStore.ids(userId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> loadProjectionRecoveryIds(Long userId) {
        return privateParamStore.ids(userId);
    }

    private Set<Long> safeIds(Set<Long> ids) {
        return ids == null ? Set.of() : ids.stream().filter(java.util.Objects::nonNull)
            .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    static String expectedProjectionStatus(UserMailAccount account) {
        if (!"0".equals(account.getDeleteFlag())) return "DELETED";
        if ("OAUTH2".equals(account.getAuthType())) {
            return StringUtils.hasText(account.getCredentialRef()) ? "NORMAL" : "AUTH_REQUIRED";
        }
        if ("APP_PASSWORD".equals(account.getAuthType()) || "API_TOKEN".equals(account.getAuthType())) {
            return StringUtils.hasText(account.getAuthCodeCipher()) ? "NORMAL" : "AUTH_REQUIRED";
        }
        return "AUTH_REQUIRED";
    }

    private Set<Long> reconcileProvider(Long userId, MailProviderVO provider, ConnectorInfo connector) {
        Set<Long> affected = new LinkedHashSet<>();
        List<UserMailAccount> accounts = privateParamStore.active(userId).stream()
            .filter(account -> provider.getCode().equals(account.getProviderCode())).toList();
        for (UserMailAccount account : accounts) {
            String reference = validAuthorizationReference(userId, connector, account.getEmail());
            String status = reference == null ? "AUTH_REQUIRED" : "NORMAL";
            if (java.util.Objects.equals(reference, account.getCredentialRef())
                    && (reference != null || java.util.Objects.equals(status, account.getStatus()))) continue;
            affected.add(account.getAccountId());
            String observedStatus = account.getStatus();
            Date observedTime = account.getUpdateTime();
            account.setCredentialRef(reference);
            account.setStatus(status);
            account.setUpdateTime(new Date());
            if (!privateParamStore.updateCheck(account, observedStatus, observedTime)) {
                throw new IllegalStateException("邮箱配置已发生变化，请重试投影");
            }
        }
        return affected;
    }

    private ConnectorInfo activeConnector(String code) {
        if (!StringUtils.hasText(code)) return null;
        try {
            return connectorInfoMapper.selectOne(new LambdaQueryWrapper<ConnectorInfo>()
                .eq(ConnectorInfo::getConnectorCode, code)
                .eq(ConnectorInfo::getStatusCd, "00A").last("LIMIT 1"));
        } catch (RuntimeException e) {
            throw new MailCredentialResolutionException(MailCredentialResolutionException.Code.INFRASTRUCTURE, e);
        }
    }

    private ConnectorInfo connectorById(Long connectorId) {
        try {
            return connectorInfoMapper.selectById(connectorId);
        } catch (RuntimeException e) {
            throw new MailCredentialResolutionException(MailCredentialResolutionException.Code.INFRASTRUCTURE, e);
        }
    }

    private String validAuthorizationReference(Long userId, ConnectorInfo connector, String accountEmail) {
        if (userId == null || connector == null || connector.getConnectorId() == null
                || !"00A".equals(connector.getStatusCd())) return null;
        ConnectorAuth auth;
        try {
            auth = connectionStateService.findEnabledActiveAuthorization(userId.toString(), connector.getConnectorId());
        } catch (RuntimeException e) {
            throw new MailCredentialResolutionException(MailCredentialResolutionException.Code.INFRASTRUCTURE, e);
        }
        if (auth == null || expired(auth.getAccessExpireTime()) || !StringUtils.hasText(auth.getAuthCredential())) {
            return null;
        }
        final String reference;
        try {
            JsonNode metadata = objectMapper.readTree(Sm4Util.decrypt(auth.getAuthCredential()));
            if (!authorizationMatchesMailbox(auth, metadata, accountEmail)) {
                return null;
            }
            reference = metadata.path("credentialReference").asText(null);
        } catch (IOException | RuntimeException e) {
            throw new MailCredentialResolutionException(MailCredentialResolutionException.Code.CORRUPT_CREDENTIAL, e);
        }
        final ConnectorCredentialSecret secret;
        try {
            secret = secretStore.findActiveByReference(reference, userId.toString()).orElse(null);
        } catch (RuntimeException e) {
            throw new MailCredentialResolutionException(MailCredentialResolutionException.Code.INFRASTRUCTURE, e);
        }
        return secret != null && connector.getConnectorId().equals(secret.connectorId())
            && java.util.Objects.equals(connector.getProviderCode(), secret.providerCode())
            && !expired(secret.accessExpiresAt()) ? reference : null;
    }

    private boolean expired(Date expiresAt) {
        return expiresAt != null && !expiresAt.after(new Date());
    }

    private boolean authorizationMatchesMailbox(ConnectorAuth auth, JsonNode metadata, String accountEmail) {
        String expected = normalizeEmail(accountEmail);
        if (expected == null) return false;
        Set<String> identities = new LinkedHashSet<>();
        addEmailIdentity(identities, auth.getAuthName());
        addEmailIdentity(identities, auth.getExternalAccountId());
        for (String field : List.of("accountName", "accountId", "principalName", "username",
                "email", "emailAddress", "mail")) {
            addEmailIdentity(identities, metadata.path(field).asText(null));
        }
        return identities.contains(expected);
    }

    private void addEmailIdentity(Set<String> identities, String candidate) {
        String normalized = normalizeEmail(candidate);
        if (normalized != null) identities.add(normalized);
    }

    private String normalizeEmail(String value) {
        if (!StringUtils.hasText(value)) return null;
        String trimmed = value.trim();
        int separator = trimmed.indexOf('@');
        if (separator <= 0 || separator != trimmed.lastIndexOf('@') || separator == trimmed.length() - 1) {
            return null;
        }
        String local = trimmed.substring(0, separator).toLowerCase(Locale.ROOT);
        try {
            String domain = IDN.toASCII(trimmed.substring(separator + 1), IDN.USE_STD3_ASCII_RULES)
                .toLowerCase(Locale.ROOT);
            return domain.isEmpty() ? null : local + "@" + domain;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
