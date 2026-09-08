package com.iwhalecloud.byai.manager.domain.mail;

import java.io.IOException;
import java.net.IDN;
import java.util.ArrayList;
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
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
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
import com.iwhalecloud.byai.manager.mapper.users.UserMailAccountMapper;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;

/** Owns all post-commit mail projection database reads and writes in independent transactions. */
@Service
public class MailAccountProjectionStateService implements MailConnectorLookup {
    private final UserMailAccountMapper mailAccountMapper;
    private final ConnectorInfoMapper connectorInfoMapper;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorCredentialSecretStore secretStore;
    private final ObjectMapper objectMapper;

    public MailAccountProjectionStateService(UserMailAccountMapper mailAccountMapper,
            ConnectorInfoMapper connectorInfoMapper, ConnectorConnectionStateService connectionStateService,
            ConnectorCredentialSecretStore secretStore, ObjectMapper objectMapper) {
        this.mailAccountMapper = mailAccountMapper;
        this.connectorInfoMapper = connectorInfoMapper;
        this.connectionStateService = connectionStateService;
        this.secretStore = secretStore;
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public List<UserMailAccount> loadActiveSnapshot(Long userId) {
        return new ArrayList<>(mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
            .eq(UserMailAccount::getUserId, userId)
            .eq(UserMailAccount::getDeleteFlag, "0")));
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
        if (provider == null || !"OAUTH2".equals(provider.getAuthType())) return Set.of();
        return reconcileProvider(userId, provider, connector);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> loadAccountIdsForConnector(Long userId, Long connectorId) {
        ConnectorInfo connector = connectorById(connectorId);
        if (connector == null) return Set.of();
        MailProviderVO provider = MailProviderCatalog.findByConnectorCode(connector.getConnectorCode()).orElse(null);
        if (provider == null) return Set.of();
        Set<Long> ids = new LinkedHashSet<>();
        for (UserMailAccount account : mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
                .eq(UserMailAccount::getUserId, userId)
                .eq(UserMailAccount::getProviderCode, provider.getCode())
                .eq(UserMailAccount::getDeleteFlag, "0"))) {
            if (account.getAccountId() != null) ids.add(account.getAccountId());
        }
        return ids;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public boolean recognizesMailConnector(Long connectorId) {
        ConnectorInfo connector = connectorInfoMapper.selectById(connectorId);
        return connector != null && MailProviderCatalog.findByConnectorCode(connector.getConnectorCode()).isPresent();
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public ConnectorInfo findActiveConnector(String connectorCode) {
        return activeConnector(connectorCode);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markProjectionFailed(Long userId, Set<Long> accountIds) {
        for (Long accountId : safeIds(accountIds)) {
            mailAccountMapper.update(null, new LambdaUpdateWrapper<UserMailAccount>()
                .set(UserMailAccount::getStatus, "PROJECTION_FAILED")
                .set(UserMailAccount::getUpdateTime, new Date())
                .eq(UserMailAccount::getUserId, userId)
                .eq(UserMailAccount::getAccountId, accountId));
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Set<Long> markProjectionSucceeded(Long userId, Set<Long> accountIds) {
        Set<Long> restored = new LinkedHashSet<>();
        for (UserMailAccount account : loadForSuccess(userId, accountIds)) {
            String status = expectedProjectionStatus(account);
            LambdaUpdateWrapper<UserMailAccount> update = new LambdaUpdateWrapper<UserMailAccount>()
                .set(UserMailAccount::getStatus, status)
                .set(UserMailAccount::getUpdateTime, new Date())
                .eq(UserMailAccount::getUserId, userId)
                .eq(UserMailAccount::getAccountId, account.getAccountId())
                .eq(UserMailAccount::getStatus, "PROJECTION_FAILED")
                .eq(account.getUpdateTime() != null, UserMailAccount::getUpdateTime, account.getUpdateTime());
            if (account.getCredentialRef() == null) {
                update.isNull(UserMailAccount::getCredentialRef);
            } else {
                update.eq(UserMailAccount::getCredentialRef, account.getCredentialRef());
            }
            if (mailAccountMapper.update(null, update) == 1) restored.add(account.getAccountId());
        }
        return restored;
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

    private List<UserMailAccount> loadForSuccess(Long userId, Set<Long> ids) {
        Set<Long> safe = safeIds(ids);
        if (safe.isEmpty()) return List.of();
        return mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
            .eq(UserMailAccount::getUserId, userId)
            .in(UserMailAccount::getAccountId, safe)
            .eq(UserMailAccount::getStatus, "PROJECTION_FAILED"));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public ProjectionUserBatch scanProjectionUsersAfter(long afterAccountId, int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        List<UserMailAccount> rows = mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
            .select(UserMailAccount::getAccountId, UserMailAccount::getUserId)
            .gt(UserMailAccount::getAccountId, afterAccountId)
            .orderByAsc(UserMailAccount::getAccountId)
            .last("LIMIT " + boundedLimit));
        Set<Long> userIds = new LinkedHashSet<>();
        long cursor = afterAccountId;
        for (UserMailAccount row : rows) {
            if (row.getUserId() != null) userIds.add(row.getUserId());
            if (row.getAccountId() != null) cursor = Math.max(cursor, row.getAccountId());
        }
        return new ProjectionUserBatch(userIds, cursor, rows.size() == boundedLimit);
    }

    public record ProjectionUserBatch(Set<Long> userIds, long nextAccountId, boolean hasMore) { }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> loadAllAccountIds(Long userId) {
        Set<Long> ids = new LinkedHashSet<>();
        for (UserMailAccount account : mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
                .select(UserMailAccount::getAccountId)
                .eq(UserMailAccount::getUserId, userId))) {
            if (account.getAccountId() != null) ids.add(account.getAccountId());
        }
        return ids;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Set<Long> loadProjectionRecoveryIds(Long userId) {
        Set<Long> ids = new LinkedHashSet<>();
        for (UserMailAccount account : mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
                .select(UserMailAccount::getAccountId)
                .eq(UserMailAccount::getUserId, userId)
                .and(scope -> scope.eq(UserMailAccount::getDeleteFlag, "0")
                    .or().eq(UserMailAccount::getStatus, "PROJECTION_FAILED")))) {
            if (account.getAccountId() != null) ids.add(account.getAccountId());
        }
        return ids;
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
        if ("APP_PASSWORD".equals(account.getAuthType()) || "API_TOKEN".equals(account.getAuthType())
                || "NTLM".equals(account.getAuthType())) {
            return StringUtils.hasText(account.getAuthCodeCipher()) ? "NORMAL" : "AUTH_REQUIRED";
        }
        if ("KERBEROS".equals(account.getAuthType())) return "NORMAL";
        return "BROWSER_SSO".equals(account.getAuthType()) ? "NORMAL" : "AUTH_REQUIRED";
    }

    private Set<Long> reconcileProvider(Long userId, MailProviderVO provider, ConnectorInfo connector) {
        Set<Long> affected = new LinkedHashSet<>();
        List<UserMailAccount> accounts = mailAccountMapper.selectList(new LambdaQueryWrapper<UserMailAccount>()
            .eq(UserMailAccount::getUserId, userId)
            .eq(UserMailAccount::getProviderCode, provider.getCode())
            .eq(UserMailAccount::getDeleteFlag, "0"));
        for (UserMailAccount account : accounts) {
            String reference = validAuthorizationReference(userId, connector, account.getEmail());
            String status = reference == null ? "AUTH_REQUIRED" : "NORMAL";
            if (java.util.Objects.equals(reference, account.getCredentialRef())
                    && java.util.Objects.equals(status, account.getStatus())) continue;
            affected.add(account.getAccountId());
            mailAccountMapper.update(null, new LambdaUpdateWrapper<UserMailAccount>()
                .set(UserMailAccount::getCredentialRef, reference)
                .set(UserMailAccount::getStatus, status)
                .set(UserMailAccount::getUpdateTime, new Date())
                .eq(UserMailAccount::getAccountId, account.getAccountId())
                .eq(UserMailAccount::getUserId, userId)
                .eq(UserMailAccount::getDeleteFlag, "0"));
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
