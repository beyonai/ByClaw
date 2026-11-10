package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.provider.media.VolcengineDigitalHumanCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** Owns the digital-human video projection, independently of model endpoint configurations. */
@Service
@Slf4j
public class DigitalHumanConfigProjectionService {

    public static final String PROJECTION_PATH = "/by/.connector-auth/.model/video.json";
    private static final String CODE = VolcengineDigitalHumanCredentialFormProvider.PROVIDER_CODE;
    private final ConnectorCredentialWorkspaceService workspaceService;
    private final ConnectorPrivateFileProjectionWriter writer;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorInfoMapper connectorInfoMapper;
    private final ConnectorAuthMapper connectorAuthMapper;

    public DigitalHumanConfigProjectionService(
            ConnectorCredentialWorkspaceService workspaceService,
            ConnectorPrivateFileProjectionWriter writer,
            ConnectorConnectionStateService connectionStateService,
            ConnectorInfoMapper connectorInfoMapper,
            ConnectorAuthMapper connectorAuthMapper) {
        this.workspaceService = workspaceService;
        this.writer = writer;
        this.connectionStateService = connectionStateService;
        this.connectorInfoMapper = connectorInfoMapper;
        this.connectorAuthMapper = connectorAuthMapper;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void handle(ConnectorCredentialProjectionEvent event) {
        if (event == null || event.userId() == null || event.connectorId() == null || event.action() == null) return;
        try {
            ConnectorInfo connector = connectorInfoMapper.selectById(event.connectorId());
            if (!supports(connector)) return;
            if (event.action() == ConnectorCredentialProjectionEvent.Action.DELETE) {
                delete(event.userId(), connector);
            } else {
                sync(event.userId(), connector);
            }
        } catch (RuntimeException e) {
            // Credentials must never appear in logs, including JSON parser exception messages.
            log.warn("Digital human projection failed for userId={}, connectorId={}",
                event.userId(), event.connectorId());
        }
    }

    @Scheduled(
        initialDelayString = "${connector.digital-human-projection-initial-delay-ms:75000}",
        fixedDelayString = "${connector.digital-human-projection-reconcile-delay-ms:1800000}")
    public void reconcileEnabledAuthorizations() {
        for (ConnectorInfo connector : connectorInfoMapper.selectList(new LambdaQueryWrapper<ConnectorInfo>()
                .eq(ConnectorInfo::getConnectorCode, CODE)
                .eq(ConnectorInfo::getStatusCd, "00A"))) {
            for (ConnectorAuth authorization : connectorAuthMapper.selectList(new LambdaQueryWrapper<ConnectorAuth>()
                    .eq(ConnectorAuth::getConnectorId, connector.getConnectorId())
                    .eq(ConnectorAuth::getEnableFlag, "Y")
                    .eq(ConnectorAuth::getStatusCd, "00A"))) {
                try {
                    sync(Long.valueOf(authorization.getUserId()), connector);
                } catch (RuntimeException e) {
                    log.warn("Digital human projection reconciliation failed for connectorId={}",
                        connector.getConnectorId());
                }
            }
        }
    }

    void sync(Long userId, ConnectorInfo connector) {
        if (!supports(connector)) return;
        if (!"00A".equals(connector.getStatusCd())) {
            delete(userId, connector);
            return;
        }
        ConnectorAuth authorization = connectionStateService.findEnabledActiveAuthorization(
            userId.toString(), connector.getConnectorId());
        if (authorization == null || !"READY".equals(authorization.getCredentialState())) {
            delete(userId, connector);
            return;
        }
        String config = configuration(authorization);
        Path target = workspaceService.resolveProjectionFile(userId, PROJECTION_PATH);
        writer.write(target, config);
    }

    void delete(Long userId, ConnectorInfo connector) {
        if (supports(connector)) writer.delete(workspaceService.resolveProjectionFile(userId, PROJECTION_PATH));
    }

    private boolean supports(ConnectorInfo connector) {
        return connector != null && CODE.equals(connector.getConnectorCode()) && CODE.equals(connector.getProviderCode());
    }

    private String configuration(ConnectorAuth authorization) {
        try {
            JSONObject metadata = JSON.parseObject(Sm4Util.decrypt(authorization.getAuthCredential()));
            JSONObject config = metadata == null ? null : metadata.getJSONObject(
                VolcengineDigitalHumanCredentialFormProvider.CONFIG_ATTRIBUTE);
            if (config == null || !Integer.valueOf(1).equals(config.get("schemaVersion"))
                    || !CODE.equals(config.get("connectorCode")) || !Boolean.TRUE.equals(config.get("enabled"))) {
                throw new IllegalArgumentException();
            }
            Map<String, String> credentials = new HashMap<>();
            credentials.put("accessKeyId", (String) config.get("accessKeyId"));
            credentials.put("secretAccessKey", (String) config.get("secretAccessKey"));
            return JSON.toJSONString(VolcengineDigitalHumanCredentialFormProvider.configuration(credentials));
        } catch (RuntimeException e) {
            throw new IllegalStateException("Invalid digital human connector configuration");
        }
    }
}
