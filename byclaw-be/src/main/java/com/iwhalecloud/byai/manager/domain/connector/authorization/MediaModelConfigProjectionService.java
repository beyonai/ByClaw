package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.provider.media.ImageGenerationModelCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.provider.media.MediaModelConfigParser;
import com.iwhalecloud.byai.manager.domain.connector.provider.media.SpeechGenerationModelCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.MediaModelProjectionSpecResolver.Projection;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import java.nio.file.Path;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.util.StringUtils;

/** Projects complete user media-model connector configurations into the mounted private workspace. */
@Service
@Slf4j
public class MediaModelConfigProjectionService {

    private static final java.util.Set<String> CONNECTOR_CODES = java.util.Set.of(
        ImageGenerationModelCredentialFormProvider.PROVIDER_CODE,
        SpeechGenerationModelCredentialFormProvider.PROVIDER_CODE);

    private final ConnectorCredentialWorkspaceService workspaceService;
    private final ConnectorPrivateFileProjectionWriter writer;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorInfoMapper connectorInfoMapper;
    private final ConnectorAuthMapper connectorAuthMapper;
    private final MediaModelProjectionSpecResolver projectionResolver;

    public MediaModelConfigProjectionService(
            ConnectorCredentialWorkspaceService workspaceService,
            ConnectorPrivateFileProjectionWriter writer,
            ConnectorConnectionStateService connectionStateService,
            ConnectorInfoMapper connectorInfoMapper,
            ConnectorAuthMapper connectorAuthMapper,
            MediaModelProjectionSpecResolver projectionResolver) {
        this.workspaceService = workspaceService;
        this.writer = writer;
        this.connectionStateService = connectionStateService;
        this.connectorInfoMapper = connectorInfoMapper;
        this.connectorAuthMapper = connectorAuthMapper;
        this.projectionResolver = projectionResolver;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void handle(ConnectorCredentialProjectionEvent event) {
        if (event == null || event.userId() == null || event.connectorId() == null || event.action() == null) return;
        try {
            ConnectorInfo connector = connectorInfoMapper.selectById(event.connectorId());
            if (projection(connector) == null) return;
            if (event.action() == ConnectorCredentialProjectionEvent.Action.DELETE) {
                delete(event.userId(), connector);
            } else {
                sync(event.userId(), connector);
            }
        } catch (RuntimeException e) {
            log.warn("Media model connector projection failed for userId={}, connectorId={}: {}",
                event.userId(), event.connectorId(), e.getMessage());
        }
    }

    @Scheduled(
        initialDelayString = "${connector.media-model-projection-initial-delay-ms:75000}",
        fixedDelayString = "${connector.media-model-projection-reconcile-delay-ms:1800000}")
    public void reconcileEnabledAuthorizations() {
        List<ConnectorInfo> connectors = connectorInfoMapper.selectList(new LambdaQueryWrapper<ConnectorInfo>()
            .in(ConnectorInfo::getConnectorCode, CONNECTOR_CODES)
            .eq(ConnectorInfo::getStatusCd, "00A"));
        for (ConnectorInfo connector : connectors) {
            for (ConnectorAuth authorization : connectorAuthMapper.selectList(
                    new LambdaQueryWrapper<ConnectorAuth>()
                        .eq(ConnectorAuth::getConnectorId, connector.getConnectorId())
                        .eq(ConnectorAuth::getEnableFlag, "Y")
                        .eq(ConnectorAuth::getStatusCd, "00A"))) {
                try {
                    sync(Long.valueOf(authorization.getUserId()), connector);
                } catch (RuntimeException e) {
                    log.warn("Media model connector reconciliation failed for userId={}, connectorId={}: {}",
                        authorization.getUserId(), connector.getConnectorId(), e.getMessage());
                }
            }
        }
    }

    void sync(Long userId, ConnectorInfo connector) {
        Projection projection = projection(connector);
        if (projection == null || !"00A".equals(connector.getStatusCd())) return;
        ConnectorAuth authorization = connectionStateService.findEnabledActiveAuthorization(
            userId.toString(), connector.getConnectorId());
        if (authorization == null || !"READY".equals(authorization.getCredentialState())) {
            delete(userId, connector);
            return;
        }
        String config = mediaConfig(authorization, connector, projection);
        Path target = workspaceService.resolveProjectionFile(userId, projection.path());
        writer.write(target, config);
    }

    void delete(Long userId, ConnectorInfo connector) {
        Projection projection = projection(connector);
        if (projection == null) return;
        writer.delete(workspaceService.resolveProjectionFile(userId, projection.path()));
    }

    private String mediaConfig(ConnectorAuth authorization, ConnectorInfo connector, Projection projection) {
        if (!StringUtils.hasText(authorization.getAuthCredential())) {
            throw new IllegalStateException("Media model connector credential is missing");
        }
        try {
            JSONObject metadata = JSON.parseObject(Sm4Util.decrypt(authorization.getAuthCredential()));
            String raw = metadata == null ? null
                : metadata.getString(MediaModelConfigParser.MEDIA_MODEL_CONFIG_ATTRIBUTE);
            JSONObject config = StringUtils.hasText(raw) ? JSON.parseObject(raw) : null;
            if (config == null
                    || config.getIntValue("schemaVersion") != 1
                    || !connector.getConnectorCode().equals(config.getString("connectorCode"))
                    || !projection.modelType().equals(config.getString("modelType"))
                    || !StringUtils.hasText(config.getString("revision"))) {
                throw new IllegalStateException("Media model connector configuration is invalid");
            }
            String normalized = JSON.toJSONString(config);
            if (normalized.getBytes(java.nio.charset.StandardCharsets.UTF_8).length
                    > ConnectorPrivateFileProjectionWriter.MAX_PROJECTION_BYTES) {
                throw new IllegalStateException("Media model connector configuration exceeds 64 KiB");
            }
            return normalized;
        } catch (RuntimeException e) {
            throw new IllegalStateException("Unable to read media model connector configuration", e);
        }
    }

    private MediaModelProjectionSpecResolver.Projection projection(ConnectorInfo connector) {
        return projectionResolver.supports(connector) ? projectionResolver.resolve(connector) : null;
    }
}
