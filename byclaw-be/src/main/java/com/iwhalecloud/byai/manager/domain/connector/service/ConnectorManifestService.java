package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** 将渠道 Runtime Manifest 中的环境变量物化为用户系统托管个人参数。 */
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
        Map<String, String> desiredEnvironment = canonicalizer.extractEnvironment(
            connector,
            connector.getRuntimeManifest()
        );
        List<UserPrivateParam> currentParams = findUserParams(userId);
        Map<String, UserPrivateParam> currentByKey = indexByKey(currentParams);
        preflightOwnership(currentByKey, connector.getConnectorCode(), desiredEnvironment);

        boolean changed = false;
        for (Map.Entry<String, String> entry : desiredEnvironment.entrySet()) {
            UserPrivateParam existing = currentByKey.get(entry.getKey());
            if (existing == null) {
                changed |= insertOrUpdateConcurrentWinner(userId, connector, entry.getKey(), entry.getValue());
            }
            else {
                changed |= updateAndEnable(existing, connector, entry.getValue());
            }
        }

        for (UserPrivateParam current : currentParams) {
            if (ownedByConnector(current, connector.getConnectorCode())
                    && !desiredEnvironment.containsKey(current.getParamKey())
                    && !DISABLED.equals(current.getStatus())) {
                current.setStatus(DISABLED);
                touch(current, userId);
                requireSingleAffectedRow(userPrivateParamMapper.updateById(current));
                changed = true;
            }
        }
        return changed;
    }

    public boolean disable(Long userId, ConnectorInfo connector) {
        requireUserAndConnector(userId, connector);
        boolean changed = false;
        for (UserPrivateParam current : findUserParams(userId)) {
            if (ownedByConnector(current, connector.getConnectorCode()) && !DISABLED.equals(current.getStatus())) {
                current.setStatus(DISABLED);
                touch(current, userId);
                requireSingleAffectedRow(userPrivateParamMapper.updateById(current));
                changed = true;
            }
        }
        return changed;
    }

    private boolean insertOrUpdateConcurrentWinner(
            Long userId,
            ConnectorInfo connector,
            String key,
            String value) {
        UserPrivateParam param = new UserPrivateParam();
        param.setParamId(sequenceService.nextVal());
        param.setUserId(userId);
        param.setParamValueCipher(Sm4Util.encrypt(value));
        param.setParamValueLast4(null);
        param.setStatus(NORMAL);
        param.setDeleteFlag(DELETE_FLAG_NORMAL);
        Date now = new Date();
        param.setCreateBy(userId);
        param.setCreateTime(now);
        param.setUpdateBy(userId);
        param.setUpdateTime(now);
        applyMetadata(param, connector, key);

        int inserted = userPrivateParamMapper.insertConnectorParamIgnoreConflict(param);
        if (inserted == 1) {
            return true;
        }
        if (inserted != 0) {
            throw new IllegalStateException("Connector environment parameter insert returned an unexpected row count");
        }
        UserPrivateParam winner = findByKey(userId, key);
        if (!ownedByConnector(winner, connector.getConnectorCode())) {
            throw new ConnectorParameterConflictException(key);
        }
        return updateAndEnable(winner, connector, value);
    }

    private boolean updateAndEnable(
            UserPrivateParam existing,
            ConnectorInfo connector,
            String value) {
        String currentValue = decryptBestEffort(existing.getParamValueCipher());
        boolean valueChanged = !Objects.equals(value, currentValue);
        boolean statusChanged = !NORMAL.equals(existing.getStatus());
        String description = description(connector, existing.getParamKey());
        boolean metadataChanged = !PARAM_SOURCE_CONNECTOR.equals(existing.getParamSource())
            || !connector.getConnectorCode().equals(existing.getSourceRef())
            || !description.equals(existing.getDescription());
        if (!valueChanged && !statusChanged && !metadataChanged) {
            return false;
        }
        if (valueChanged) {
            existing.setParamValueCipher(Sm4Util.encrypt(value));
            existing.setParamValueLast4(null);
        }
        applyMetadata(existing, connector, existing.getParamKey());
        existing.setStatus(NORMAL);
        touch(existing, existing.getUserId());
        requireSingleAffectedRow(userPrivateParamMapper.updateById(existing));
        return true;
    }

    private void preflightOwnership(
            Map<String, UserPrivateParam> currentByKey,
            String connectorCode,
            Map<String, String> desiredEnvironment) {
        for (String key : desiredEnvironment.keySet()) {
            UserPrivateParam existing = currentByKey.get(key);
            if (existing != null && !ownedByConnector(existing, connectorCode)) {
                throw new ConnectorParameterConflictException(key);
            }
        }
    }

    private Map<String, UserPrivateParam> indexByKey(List<UserPrivateParam> params) {
        Map<String, UserPrivateParam> result = new HashMap<>();
        for (UserPrivateParam param : params) {
            result.put(param.getParamKey(), param);
        }
        return result;
    }

    private List<UserPrivateParam> findUserParams(Long userId) {
        return userPrivateParamMapper.selectList(new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getUserId, userId)
            .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL));
    }

    private UserPrivateParam findByKey(Long userId, String key) {
        return userPrivateParamMapper.selectOne(new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getUserId, userId)
            .eq(UserPrivateParam::getParamKey, key)
            .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL)
            .last("LIMIT 1"));
    }

    private boolean ownedByConnector(UserPrivateParam param, String connectorCode) {
        return param != null
            && PARAM_SOURCE_CONNECTOR.equals(param.getParamSource())
            && connectorCode.equals(param.getSourceRef());
    }

    private void applyMetadata(UserPrivateParam param, ConnectorInfo connector, String key) {
        param.setParamKey(key);
        param.setDescription(description(connector, key));
        param.setParamSource(PARAM_SOURCE_CONNECTOR);
        param.setSourceRef(connector.getConnectorCode());
    }

    private String description(ConnectorInfo connector, String key) {
        String connectorName = StringUtils.hasText(connector.getConnectorName())
            ? connector.getConnectorName().trim()
            : connector.getConnectorCode();
        return "系统托管连接器环境参数：" + connectorName + " / " + key;
    }

    private void touch(UserPrivateParam param, Long userId) {
        param.setUpdateBy(userId);
        param.setUpdateTime(new Date());
    }

    private String decryptBestEffort(String cipher) {
        if (!StringUtils.hasText(cipher)) {
            return null;
        }
        try {
            return Sm4Util.decrypt(cipher);
        }
        catch (RuntimeException e) {
            return null;
        }
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
            throw new IllegalStateException("Connector environment parameter write did not affect exactly one row");
        }
    }
}
