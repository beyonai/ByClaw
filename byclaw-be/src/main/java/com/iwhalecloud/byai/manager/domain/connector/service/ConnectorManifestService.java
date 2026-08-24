package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

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
        List<String> managedKeys = managedEnvironmentKeys(connector);
        if (!managedKeys.isEmpty()) {
            return upsertAndEnable(userId, connector, Map.of());
        }
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

    /**
     * Atomically applies a complete managed credential set and enables it. Empty input only re-enables
     * the already stored managed values; it never creates blank credential rows.
     */
    public boolean upsertAndEnable(Long userId, ConnectorInfo connector, Map<String, String> credentials) {
        requireUserAndConnector(userId, connector);
        List<String> managedKeys = managedEnvironmentKeys(connector);
        if (managedKeys.isEmpty()) {
            if (credentials != null && !credentials.isEmpty()) {
                throw new IllegalArgumentException("Connector has no managed credential keys");
            }
            return upsertAndEnable(userId, connector);
        }
        Set<String> allowedKeys = Set.copyOf(managedKeys);
        if (credentials == null || credentials.isEmpty()) {
            requireCompleteManagedCredentialPair(userId, connector, allowedKeys);
            return updateManagedEnvironmentStatus(userId, connector, managedKeys, NORMAL);
        }
        if (!credentials.keySet().equals(allowedKeys) || credentials.values().stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("Managed connector credentials must exactly match the manifest allowlist");
        }
        List<UserPrivateParam> currentParams = findUserParams(userId);
        Map<String, UserPrivateParam> currentByKey = indexByKey(currentParams);
        preflightOwnership(currentParams, connector.getConnectorCode(), credentials);

        boolean changed = false;
        for (String key : managedKeys) {
            UserPrivateParam existing = currentByKey.get(key);
            if (existing == null) {
                changed |= insertOrUpdateConcurrentWinner(userId, connector, key, credentials.get(key));
            } else {
                changed |= updateAndEnable(existing, connector, credentials.get(key));
            }
        }
        changed |= removeObsoleteManagedCredentials(currentParams, connector, allowedKeys);
        return changed;
    }

    /** Reads only exact, connector-owned managed credential keys and decrypts them for an in-memory probe. */
    public Map<String, String> readManagedCredentials(
            Long userId,
            ConnectorInfo connector,
            Set<String> requestedKeys) {
        requireUserAndConnector(userId, connector);
        Set<String> allowedKeys = Set.copyOf(managedEnvironmentKeys(connector));
        if (!allowedKeys.equals(requestedKeys)) {
            throw new IllegalArgumentException("Requested credential keys must exactly match the manifest allowlist");
        }
        Map<String, String> credentials = new HashMap<>();
        for (UserPrivateParam param : userPrivateParamMapper.selectList(new LambdaQueryWrapper<UserPrivateParam>()
                .eq(UserPrivateParam::getUserId, userId)
                .eq(UserPrivateParam::getParamSource, PARAM_SOURCE_CONNECTOR)
                .eq(UserPrivateParam::getSourceRef, connector.getConnectorCode())
                .in(UserPrivateParam::getParamKey, allowedKeys)
                .eq(UserPrivateParam::getStatus, NORMAL)
                .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL))) {
            if (userId.equals(param.getUserId()) && ownedByConnector(param, connector.getConnectorCode())
                    && allowedKeys.contains(param.getParamKey())) {
                String value = decryptBestEffort(param.getParamValueCipher());
                if (value != null) {
                    credentials.put(param.getParamKey(), value);
                }
            }
        }
        return Map.copyOf(credentials);
    }

    /**
     * Strict verification-only read of a complete owned managed set. NORMAL and DISABLED pairs are eligible,
     * but every row must have the same state. This method never enables rows or writes runtime cache state.
     */
    public Map<String, String> readManagedCredentialsForVerification(
            Long userId,
            ConnectorInfo connector,
            Set<String> requestedKeys) {
        requireUserAndConnector(userId, connector);
        Set<String> allowedKeys = Set.copyOf(managedEnvironmentKeys(connector));
        if (!allowedKeys.equals(requestedKeys)) {
            throw new IllegalArgumentException("Requested credential keys must exactly match the manifest allowlist");
        }
        Map<String, String> credentials = new HashMap<>();
        Set<String> statuses = new java.util.HashSet<>();
        for (UserPrivateParam param : userPrivateParamMapper.selectList(new LambdaQueryWrapper<UserPrivateParam>()
                .eq(UserPrivateParam::getUserId, userId)
                .eq(UserPrivateParam::getParamSource, PARAM_SOURCE_CONNECTOR)
                .eq(UserPrivateParam::getSourceRef, connector.getConnectorCode())
                .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL))) {
            if (!userId.equals(param.getUserId()) || !ownedByConnector(param, connector.getConnectorCode())) {
                continue;
            }
            if (!allowedKeys.contains(param.getParamKey())
                    || (!NORMAL.equals(param.getStatus()) && !DISABLED.equals(param.getStatus()))) {
                throw new IllegalStateException("Managed connector credential set is invalid");
            }
            String value = decryptBestEffort(param.getParamValueCipher());
            if (!StringUtils.hasText(value) || credentials.putIfAbsent(param.getParamKey(), value) != null) {
                throw new IllegalStateException("Managed connector credential set is invalid");
            }
            statuses.add(param.getStatus());
        }
        if (!credentials.keySet().equals(allowedKeys) || statuses.size() != 1) {
            throw new IllegalStateException("Managed connector credential set is invalid");
        }
        return Map.copyOf(credentials);
    }

    /** Removes every connector-owned managed credential row, including keys retired by a manifest upgrade. */
    public boolean removeManagedCredentials(Long userId, ConnectorInfo connector) {
        requireUserAndConnector(userId, connector);
        String connectorCode = connector.getConnectorCode();
        boolean changed = false;
        for (UserPrivateParam param : userPrivateParamMapper.selectList(new LambdaQueryWrapper<UserPrivateParam>()
                .eq(UserPrivateParam::getUserId, userId)
                .eq(UserPrivateParam::getParamSource, PARAM_SOURCE_CONNECTOR)
                .eq(UserPrivateParam::getSourceRef, connectorCode)
                .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL))) {
            if (userId.equals(param.getUserId()) && ownedByConnector(param, connectorCode)
                    && PARAM_SOURCE_CONNECTOR.equals(param.getParamSource())) {
                requireSingleAffectedRow(userPrivateParamMapper.deleteById(param.getParamId()));
                changed = true;
            }
        }
        return changed;
    }

    private boolean removeObsoleteManagedCredentials(
            List<UserPrivateParam> currentParams,
            ConnectorInfo connector,
            Set<String> allowedKeys) {
        boolean changed = false;
        for (UserPrivateParam current : currentParams) {
            if (ownedByConnector(current, connector.getConnectorCode())
                    && !allowedKeys.contains(current.getParamKey())) {
                requireSingleAffectedRow(userPrivateParamMapper.deleteById(current.getParamId()));
                changed = true;
            }
        }
        return changed;
    }

    public boolean disable(Long userId, ConnectorInfo connector) {
        requireUserAndConnector(userId, connector);
        List<String> managedKeys = managedEnvironmentKeys(connector);
        if (!managedKeys.isEmpty()) {
            return updateManagedEnvironmentStatus(userId, connector, managedKeys, DISABLED);
        }
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

    /**
     * 返回允许后续凭据作业写入的受管环境变量名；本服务不会从 Runtime Manifest 写入凭据值。
     */
    public List<String> managedEnvironmentKeys(ConnectorInfo connector) {
        requireConnector(connector);
        return canonicalizer.extractManagedEnvironmentKeys(connector, connector.getRuntimeManifest());
    }

    private boolean updateManagedEnvironmentStatus(
            Long userId,
            ConnectorInfo connector,
            List<String> managedKeys,
            String status) {
        Set<String> allowedKeys = Set.copyOf(managedKeys);
        boolean changed = false;
        for (UserPrivateParam current : findUserParams(userId)) {
            if (ownedByConnector(current, connector.getConnectorCode())
                    && allowedKeys.contains(current.getParamKey())
                    && !status.equals(current.getStatus())) {
                current.setStatus(status);
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

    private void requireCompleteManagedCredentialPair(
            Long userId,
            ConnectorInfo connector,
            Set<String> allowedKeys) {
        Set<String> storedKeys = new java.util.HashSet<>();
        Set<String> statuses = new java.util.HashSet<>();
        for (UserPrivateParam param : findUserParams(userId)) {
            if (ownedByConnector(param, connector.getConnectorCode())) {
                if (!allowedKeys.contains(param.getParamKey()) || !storedKeys.add(param.getParamKey())
                        || (!NORMAL.equals(param.getStatus()) && !DISABLED.equals(param.getStatus()))
                        || !StringUtils.hasText(decryptBestEffort(param.getParamValueCipher()))) {
                    throw new IllegalStateException("Managed connector credential rows are incomplete");
                }
                statuses.add(param.getStatus());
            }
        }
        if (!storedKeys.equals(allowedKeys) || statuses.size() != 1) {
            throw new IllegalStateException("Managed connector credential rows are incomplete");
        }
    }

    private void preflightOwnership(
            List<UserPrivateParam> currentParams,
            String connectorCode,
            Map<String, String> desiredEnvironment) {
        for (UserPrivateParam existing : currentParams) {
            if (desiredEnvironment.containsKey(existing.getParamKey()) && !ownedByConnector(existing, connectorCode)) {
                throw new ConnectorParameterConflictException(existing.getParamKey());
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
        requireConnector(connector);
    }

    private void requireConnector(ConnectorInfo connector) {
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
