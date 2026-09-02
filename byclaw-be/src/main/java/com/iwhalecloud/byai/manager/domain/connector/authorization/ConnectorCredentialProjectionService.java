package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.util.StringUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer.CredentialProjectionSpec;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;

import lombok.extern.slf4j.Slf4j;

/** Materializes manifest-declared OAuth2 credentials into each user's mounted private workspace. */
@Slf4j
@Service
public class ConnectorCredentialProjectionService {

    private static final long MAX_CREDENTIAL_FILE_BYTES = 64 * 1024L;
    private static final Set<PosixFilePermission> PRIVATE_FILE_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ,
        PosixFilePermission.OWNER_WRITE);

    private final ConnectorCredentialWorkspaceService workspaceService;
    private final ConnectorCredentialSecretStore secretStore;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorManifestService manifestService;
    private final ConnectorInfoMapper connectorInfoMapper;
    private final ConnectorAuthMapper connectorAuthMapper;
    private final ObjectMapper objectMapper;

    public ConnectorCredentialProjectionService(
            ConnectorCredentialWorkspaceService workspaceService,
            ConnectorCredentialSecretStore secretStore,
            ConnectorConnectionStateService connectionStateService,
            ConnectorManifestService manifestService,
            ConnectorInfoMapper connectorInfoMapper,
            ConnectorAuthMapper connectorAuthMapper,
            ObjectMapper objectMapper) {
        this.workspaceService = workspaceService;
        this.secretStore = secretStore;
        this.connectionStateService = connectionStateService;
        this.manifestService = manifestService;
        this.connectorInfoMapper = connectorInfoMapper;
        this.connectorAuthMapper = connectorAuthMapper;
        this.objectMapper = objectMapper;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void handle(ConnectorCredentialProjectionEvent event) {
        if (event == null || event.userId() == null || event.connectorId() == null || event.action() == null) {
            return;
        }
        try {
            ConnectorInfo connector = connectorInfoMapper.selectById(event.connectorId());
            if (connector == null) {
                return;
            }
            if (event.action() == ConnectorCredentialProjectionEvent.Action.DELETE) {
                delete(event.userId(), connector);
            } else {
                sync(event.userId(), connector);
            }
        } catch (RuntimeException e) {
            log.warn("Connector credential projection failed for userId={}, connectorId={}: {}",
                event.userId(), event.connectorId(), e.getMessage());
        }
    }

    @Scheduled(
        initialDelayString = "${connector.credential-projection-initial-delay-ms:60000}",
        fixedDelayString = "${connector.credential-projection-reconcile-delay-ms:1800000}")
    public void reconcileEnabledAuthorizations() {
        List<ConnectorInfo> connectors = connectorInfoMapper.selectList(new LambdaQueryWrapper<ConnectorInfo>()
            .eq(ConnectorInfo::getStatusCd, "00A"));
        for (ConnectorInfo connector : connectors) {
            if (projectionSpec(connector).isEmpty()) {
                continue;
            }
            List<ConnectorAuth> authorizations = connectorAuthMapper.selectList(
                new LambdaQueryWrapper<ConnectorAuth>()
                    .eq(ConnectorAuth::getConnectorId, connector.getConnectorId())
                    .eq(ConnectorAuth::getEnableFlag, "Y")
                    .eq(ConnectorAuth::getStatusCd, "00A"));
            for (ConnectorAuth authorization : authorizations) {
                try {
                    sync(Long.valueOf(authorization.getUserId()), connector);
                } catch (RuntimeException e) {
                    log.warn("Connector credential reconciliation failed for userId={}, connectorId={}: {}",
                        authorization.getUserId(), connector.getConnectorId(), e.getMessage());
                }
            }
        }
    }

    void sync(Long userId, ConnectorInfo connector) {
        Optional<CredentialProjectionSpec> projection = projectionSpec(connector);
        if (projection.isEmpty()) {
            return;
        }
        if (!isActiveConnector(connector)) {
            delete(userId, connector);
            return;
        }
        ConnectorAuth authorization = connectionStateService.findEnabledActiveAuthorization(
            userId.toString(), connector.getConnectorId());
        if (authorization == null || expired(authorization.getAccessExpireTime())) {
            delete(userId, projection.get());
            return;
        }
        String expectedReference = credentialReference(authorization);
        ConnectorCredentialSecret secret = secretStore.findActive(
            userId.toString(), connector.getConnectorId(), connector.getProviderCode()).orElse(null);
        if (secret == null || !StringUtils.hasText(expectedReference)
                || !expectedReference.equals(secret.credentialReference())
                || !StringUtils.hasText(secret.accessToken()) || expired(secret.accessExpiresAt())) {
            delete(userId, projection.get());
            return;
        }
        write(userId, connector, authorization, secret, projection.get());
    }

    void delete(Long userId, ConnectorInfo connector) {
        projectionSpec(connector).ifPresent(projection -> delete(userId, projection));
    }

    private void delete(Long userId, CredentialProjectionSpec projection) {
        Path credentialFile = workspaceService.resolveProjectionFile(userId, projection.projectionPath());
        try {
            Files.deleteIfExists(credentialFile);
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to delete connector credential projection", e);
        }
    }

    private void write(
            Long userId,
            ConnectorInfo connector,
            ConnectorAuth authorization,
            ConnectorCredentialSecret secret,
            CredentialProjectionSpec projection) {
        Path credentialFile = workspaceService.resolveProjectionFile(userId, projection.projectionPath());
        Path directory = credentialFile.getParent();
        if (Files.isSymbolicLink(credentialFile)) {
            throw new IllegalStateException("Connector credential projection must not be a symbolic link");
        }
        if (projectionMatches(credentialFile, connector, secret)) {
            try {
                applyPrivatePermissions(credentialFile);
            } catch (IOException e) {
                throw new IllegalStateException("Unable to secure connector credential projection", e);
            }
            return;
        }
        Path temporary = null;
        try {
            byte[] content = credentialJson(connector, authorization, secret).getBytes(StandardCharsets.UTF_8);
            temporary = Files.createTempFile(directory, ".credential-", ".tmp");
            applyPrivatePermissions(temporary);
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                channel.write(ByteBuffer.wrap(content));
                channel.force(true);
            }
            try {
                Files.move(temporary, credentialFile, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, credentialFile, StandardCopyOption.REPLACE_EXISTING);
            }
            temporary = null;
            applyPrivatePermissions(credentialFile);
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to write connector credential projection", e);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // A later workspace cleanup can remove an abandoned private temporary file.
                }
            }
        }
    }

    private String credentialJson(
            ConnectorInfo connector, ConnectorAuth authorization, ConnectorCredentialSecret secret) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("schemaVersion", 1);
        root.put("connectorCode", connector.getConnectorCode());
        root.put("provider", connector.getConnectorCode());
        root.put("providerCode", connector.getProviderCode());
        root.put("credentialReference", secret.credentialReference());
        root.put("accessToken", secret.accessToken());
        putIfHasText(root, "tokenType", secret.tokenType());
        ArrayNode scopes = root.putArray("scopes");
        splitScopes(secret.grantedScopes()).forEach(scopes::add);
        putIfHasText(root, "accountLogin", authorization.getAuthName());
        if (secret.accessExpiresAt() != null) {
            root.put("accessExpiresAt", secret.accessExpiresAt().toInstant().toString());
        }
        root.put("updatedAt", Instant.now().toString());
        try {
            return objectMapper.writeValueAsString(root);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to serialize connector credential projection", e);
        }
    }

    private boolean projectionMatches(
            Path credentialFile, ConnectorInfo connector, ConnectorCredentialSecret secret) {
        try {
            if (!Files.isRegularFile(credentialFile, LinkOption.NOFOLLOW_LINKS)
                    || Files.size(credentialFile) > MAX_CREDENTIAL_FILE_BYTES) {
                return false;
            }
            JsonNode current = objectMapper.readTree(credentialFile.toFile());
            return current != null
                && connector.getConnectorCode().equals(current.path("connectorCode").asText())
                && secret.credentialReference().equals(current.path("credentialReference").asText())
                && secret.accessToken().equals(current.path("accessToken").asText());
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    private Optional<CredentialProjectionSpec> projectionSpec(ConnectorInfo connector) {
        try {
            return connector == null ? Optional.empty() : manifestService.credentialProjection(connector);
        } catch (RuntimeException e) {
            log.warn("Ignoring invalid connector credential projection manifest for connectorId={}: {}",
                connector == null ? null : connector.getConnectorId(), e.getMessage());
            return Optional.empty();
        }
    }

    private String credentialReference(ConnectorAuth authorization) {
        if (!StringUtils.hasText(authorization.getAuthCredential())) {
            return null;
        }
        try {
            JSONObject metadata = JSON.parseObject(Sm4Util.decrypt(authorization.getAuthCredential()));
            return metadata == null ? null : metadata.getString("credentialReference");
        } catch (RuntimeException e) {
            return null;
        }
    }

    private boolean isActiveConnector(ConnectorInfo connector) {
        return connector != null && connector.getConnectorId() != null
            && "00A".equals(connector.getStatusCd())
            && StringUtils.hasText(connector.getConnectorCode())
            && StringUtils.hasText(connector.getProviderCode());
    }

    private boolean expired(Date expiresAt) {
        return expiresAt != null && !expiresAt.after(new Date());
    }

    private List<String> splitScopes(String scopes) {
        if (!StringUtils.hasText(scopes)) {
            return List.of();
        }
        return Arrays.stream(scopes.split("[,\\s]+"))
            .filter(StringUtils::hasText)
            .distinct()
            .sorted()
            .toList();
    }

    private void putIfHasText(ObjectNode root, String field, String value) {
        if (StringUtils.hasText(value)) {
            root.put(field, value);
        }
    }

    private void applyPrivatePermissions(Path file) throws IOException {
        PosixFileAttributeView view = Files.getFileAttributeView(
            file, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (view != null) {
            Files.setPosixFilePermissions(file, PRIVATE_FILE_PERMISSIONS);
        }
    }
}
