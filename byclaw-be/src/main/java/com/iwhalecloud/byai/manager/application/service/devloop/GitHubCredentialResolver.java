package com.iwhalecloud.byai.manager.application.service.devloop;

import java.util.Date;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;

import lombok.extern.slf4j.Slf4j;

/**
 * Resolves the current user's GitHub credential from the authorized connector first, while retaining the
 * legacy user-managed {@code GH_TOKEN} as a compatibility fallback.
 */
@Slf4j
@Service
public class GitHubCredentialResolver {

    private static final String CONNECTOR_CODE = "github";
    private static final String REAUTH_REQUIRED = "REAUTH_REQUIRED";

    private final ConnectorInfoService connectorInfoService;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorCredentialSecretStore credentialSecretStore;
    private final DevloopPatService patService;
    private final UserService userService;

    public GitHubCredentialResolver(
            ConnectorInfoService connectorInfoService,
            ConnectorConnectionStateService connectionStateService,
            ConnectorCredentialSecretStore credentialSecretStore,
            DevloopPatService patService,
            UserService userService) {
        this.connectorInfoService = connectorInfoService;
        this.connectionStateService = connectionStateService;
        this.credentialSecretStore = credentialSecretStore;
        this.patService = patService;
        this.userService = userService;
    }

    public String resolve(Long userId) {
        return userId == null ? null : resolve(String.valueOf(userId));
    }

    public String resolve(String userId) {
        if (!StringUtils.hasText(userId)) {
            return null;
        }
        String connectorToken = resolveConnectorToken(userId.trim());
        if (StringUtils.hasText(connectorToken)) {
            return connectorToken;
        }
        return patService.getGitHubPat(userId.trim());
    }

    public String resolveByUserCode(String userCode) {
        if (!StringUtils.hasText(userCode)) {
            return null;
        }
        Users user = userService.findByUserCode(userCode.trim());
        return user == null ? null : resolve(user.getUserId());
    }

    private String resolveConnectorToken(String userId) {
        try {
            ConnectorInfo connector = connectorInfoService.findByCode(CONNECTOR_CODE);
            if (connector == null || connector.getConnectorId() == null || !"00A".equals(connector.getStatusCd())
                    || !StringUtils.hasText(connector.getProviderCode())) {
                return null;
            }
            ConnectorAuth auth = connectionStateService.findEnabledActiveAuthorization(
                userId, connector.getConnectorId());
            if (!usable(auth)) {
                return null;
            }
            ConnectorCredentialSecret credential = credentialSecretStore.findActive(
                userId, connector.getConnectorId(), connector.getProviderCode()).orElse(null);
            if (credential == null || !matchesAuthorization(auth, credential) || expired(credential.accessExpiresAt())
                    || !StringUtils.hasText(credential.accessToken())) {
                return null;
            }
            return credential.accessToken();
        } catch (RuntimeException e) {
            log.warn("Unable to resolve GitHub connector credential for userId={}, falling back to legacy GH_TOKEN: {}",
                userId, e.getMessage());
            return null;
        }
    }

    private boolean matchesAuthorization(ConnectorAuth auth, ConnectorCredentialSecret credential) {
        if (!StringUtils.hasText(auth.getAuthCredential())
                || !StringUtils.hasText(credential.credentialReference())) {
            return false;
        }
        JSONObject metadata = JSON.parseObject(Sm4Util.decrypt(auth.getAuthCredential()));
        String reference = metadata == null ? null : metadata.getString("credentialReference");
        return credential.credentialReference().equals(reference);
    }

    private boolean usable(ConnectorAuth auth) {
        return auth != null
            && !REAUTH_REQUIRED.equals(auth.getCredentialState())
            && !expired(auth.getAccessExpireTime());
    }

    private boolean expired(Date expiresAt) {
        return expiresAt != null && !expiresAt.after(new Date());
    }
}
