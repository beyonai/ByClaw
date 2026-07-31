package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.Date;
import java.util.Locale;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** 将渠道最新 Runtime Manifest 物化为用户系统托管个人参数。 */
@Service
public class ConnectorManifestService {

    public static final String PARAM_SOURCE_CONNECTOR = "CONNECTOR";
    public static final String PARAM_SOURCE_USER = "USER";
    public static final String NORMAL = "NORMAL";
    public static final String DISABLED = "DISABLED";

    private static final String DELETE_FLAG_NORMAL = "0";

    private final UserPrivateParamMapper userPrivateParamMapper;
    private final SequenceService sequenceService;
    private final ConnectorManifestCanonicalizer canonicalizer;

    public ConnectorManifestService(
            UserPrivateParamMapper userPrivateParamMapper,
            SequenceService sequenceService,
            ConnectorManifestCanonicalizer canonicalizer) {
        this.userPrivateParamMapper = userPrivateParamMapper;
        this.sequenceService = sequenceService;
        this.canonicalizer = canonicalizer;
    }

    public boolean upsertAndEnable(Long userId, ConnectorInfo connector) {
        requireUserAndConnector(userId, connector);
        String canonicalManifest = canonicalizer.canonicalize(connector, connector.getRuntimeManifest());
        UserPrivateParam existing = findSnapshot(userId, connector.getConnectorCode());
        if (existing != null) {
            return updateExisting(existing, connector, canonicalManifest);
        }
        int inserted = insertSnapshot(userId, connector, canonicalManifest);
        if (inserted == 1) {
            return true;
        }
        if (inserted != 0) {
            throw new IllegalStateException("Connector Manifest insert returned an unexpected row count");
        }
        UserPrivateParam winner = findSnapshot(userId, connector.getConnectorCode());
        if (winner == null) {
            throw new IllegalStateException("Connector Manifest conflict without a managed snapshot");
        }
        return updateExisting(winner, connector, canonicalManifest);
    }

    public boolean disable(Long userId, ConnectorInfo connector) {
        requireUserAndConnector(userId, connector);
        UserPrivateParam existing = findSnapshot(userId, connector.getConnectorCode());
        if (existing == null || DISABLED.equals(existing.getStatus())) {
            return false;
        }
        existing.setStatus(DISABLED);
        existing.setUpdateBy(userId);
        existing.setUpdateTime(new Date());
        requireSingleAffectedRow(userPrivateParamMapper.updateById(existing));
        return true;
    }

    private boolean updateExisting(
            UserPrivateParam existing,
            ConnectorInfo connector,
            String canonicalManifest) {
        String currentManifest = decryptBestEffort(existing.getParamValueCipher());
        String currentCanonical = canonicalizeBestEffort(connector, currentManifest);
        boolean contentChanged = !canonicalManifest.equals(currentCanonical);
        boolean statusChanged = !NORMAL.equals(existing.getStatus());
        boolean metadataChanged = !PARAM_SOURCE_CONNECTOR.equals(existing.getParamSource())
            || !connector.getConnectorCode().equals(existing.getSourceRef())
            || !paramKey(connector.getConnectorCode()).equals(existing.getParamKey());
        if (!contentChanged && !statusChanged && !metadataChanged) {
            return false;
        }
        if (contentChanged) {
            existing.setParamValueCipher(Sm4Util.encrypt(canonicalManifest));
            existing.setParamValueLast4(null);
        }
        applyMetadata(existing, connector);
        existing.setStatus(NORMAL);
        existing.setUpdateBy(existing.getUserId());
        existing.setUpdateTime(new Date());
        requireSingleAffectedRow(userPrivateParamMapper.updateById(existing));
        return true;
    }

    private int insertSnapshot(Long userId, ConnectorInfo connector, String canonicalManifest) {
        Date now = new Date();
        UserPrivateParam snapshot = new UserPrivateParam();
        snapshot.setParamId(sequenceService.nextVal());
        snapshot.setUserId(userId);
        snapshot.setParamValueCipher(Sm4Util.encrypt(canonicalManifest));
        snapshot.setParamValueLast4(null);
        snapshot.setStatus(NORMAL);
        snapshot.setDeleteFlag(DELETE_FLAG_NORMAL);
        snapshot.setCreateBy(userId);
        snapshot.setCreateTime(now);
        snapshot.setUpdateBy(userId);
        snapshot.setUpdateTime(now);
        applyMetadata(snapshot, connector);
        return userPrivateParamMapper.insertConnectorSnapshotIgnoreConflict(snapshot);
    }

    private void applyMetadata(UserPrivateParam snapshot, ConnectorInfo connector) {
        snapshot.setParamKey(paramKey(connector.getConnectorCode()));
        snapshot.setDescription("系统托管连接器 Manifest：" + displayName(connector));
        snapshot.setParamSource(PARAM_SOURCE_CONNECTOR);
        snapshot.setSourceRef(connector.getConnectorCode());
    }

    private UserPrivateParam findSnapshot(Long userId, String connectorCode) {
        return userPrivateParamMapper.selectOne(new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getUserId, userId)
            .eq(UserPrivateParam::getParamSource, PARAM_SOURCE_CONNECTOR)
            .eq(UserPrivateParam::getSourceRef, connectorCode)
            .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL)
            .last("LIMIT 1"));
    }

    private String canonicalizeBestEffort(ConnectorInfo connector, String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return canonicalizer.canonicalize(connector, value);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private String decryptBestEffort(String cipher) {
        if (!StringUtils.hasText(cipher)) {
            return null;
        }
        try {
            return Sm4Util.decrypt(cipher);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private String paramKey(String connectorCode) {
        String normalized = connectorCode.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "_");
        return "CONNECTOR_" + normalized + "_MANIFEST";
    }

    private String displayName(ConnectorInfo connector) {
        return StringUtils.hasText(connector.getConnectorName())
            ? connector.getConnectorName().trim()
            : connector.getConnectorCode();
    }

    private void requireUserAndConnector(Long userId, ConnectorInfo connector) {
        if (userId == null || userId <= 0) {
            throw new IllegalArgumentException("userId must be positive");
        }
        if (connector == null || !StringUtils.hasText(connector.getConnectorCode())) {
            throw new IllegalArgumentException("connectorCode must not be blank");
        }
    }

    private void requireSingleAffectedRow(int affectedRows) {
        if (affectedRows != 1) {
            throw new IllegalStateException("Connector Manifest write did not affect exactly one row");
        }
    }
}
