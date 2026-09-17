package com.iwhalecloud.byai.manager.domain.mail;

import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.LinkedHashSet;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Connector-owned encrypted mail configurations, including durable revocation tombstones. */
@Service
public class MailPrivateParamStore {
    public static final String KEY_PREFIX = "MAIL_CONNECTOR_";
    private final UserPrivateParamMapper mapper;
    private final ObjectMapper json;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.sys.service.SequenceService sequenceService;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper connectors;

    public MailPrivateParamStore(UserPrivateParamMapper mapper, ObjectMapper json) {
        this.mapper = mapper;
        this.json = json;
    }

    public static boolean supports(ConnectorInfo connector) {
        return connector != null
            && MailProviderCatalog.findByConnectorCode(connector.getConnectorCode()).isPresent();
    }

    public String oauthConfiguration(Long userId, ConnectorInfo connector,
            com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult result) {
        String email = java.util.stream.Stream.concat(
                java.util.stream.Stream.of(result.accountName(), result.accountId()),
                result.accountAttributes().values().stream())
            .filter(value -> value != null && value.trim().matches("[^\\s@]+@[^\\s@]+"))
            .map(String::trim).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("OAuth 授权未返回邮箱身份"));
        UserMailAccount account = find(userId, connector.getConnectorId());
        if (account == null) {
            account = new UserMailAccount();
            account.setCreateBy(userId);
            account.setCreateTime(new Date());
        }
        account.setUserId(userId);
        account.setAccountId(connector.getConnectorId());
        account.setConnectorId(connector.getConnectorId());
        account.setProviderCode(MailProviderCatalog.findByConnectorCode(connector.getConnectorCode()).orElseThrow().getCode());
        account.setAccountName(email);
        account.setEmail(email);
        account.setAuthType("OAUTH2");
        account.setCredentialRef(result.credentialReference());
        account.setAuthCodeCipher(null);
        account.setAuthCodeLast4(null);
        account.setStatus("PENDING");
        account.setDeleteFlag("0");
        account.setUpdateBy(userId);
        account.setUpdateTime(new Date());
        return encode(account);
    }

    public static String key(Long connectorId) {
        if (connectorId == null || connectorId <= 0) throw new IllegalArgumentException("Invalid mail connector id");
        return KEY_PREFIX + connectorId;
    }

    public static boolean isPrivateMailParam(UserPrivateParam row) {
        return row != null && "CONNECTOR".equals(row.getParamSource())
            && ((row.getParamKey() != null && row.getParamKey().matches("MAIL_CONNECTOR_[0-9]+")
                && row.getSourceRef() != null && MailProviderCatalog.findByConnectorCode(row.getSourceRef()).isPresent()));
    }

    public String encode(UserMailAccount account) {
        try {
            return json.writeValueAsString(account);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Unable to encode mail configuration");
        }
    }

    private List<UserPrivateParam> rows(Long userId) {
        return mapper.selectList(new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getUserId, userId).eq(UserPrivateParam::getParamSource, "CONNECTOR")
            .eq(UserPrivateParam::getDeleteFlag, "0")
            .likeRight(UserPrivateParam::getParamKey, "MAIL_")).stream()
            .filter(MailPrivateParamStore::isPrivateMailParam).toList();
    }

    private UserMailAccount decode(UserPrivateParam row) {
        Long connectorId = Long.valueOf(row.getParamKey().substring(KEY_PREFIX.length()));
        UserMailAccount account;
        try {
            account = row.getParamValueCipher() == null || row.getParamValueCipher().isBlank()
                ? new UserMailAccount()
                : json.readerFor(UserMailAccount.class)
                    .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(Sm4Util.decrypt(row.getParamValueCipher()));
            if (account == null) throw new IllegalStateException("Invalid mail account document");
        } catch (Exception e) {
            throw new IllegalStateException("Invalid encrypted mail configuration for paramId=" + row.getParamId());
        }
        // Ownership and identity come from the database row, never the serialized payload.
        account.setUserId(row.getUserId());
        account.setConnectorId(connectorId);
        account.setAccountId(connectorId);
        account.setProviderCode(MailProviderCatalog.findByConnectorCode(row.getSourceRef()).orElseThrow().getCode());
        account.setDeleteFlag("NORMAL".equals(row.getStatus()) ? "0" : "1");
        if (!"0".equals(account.getDeleteFlag())) account.setStatus("DELETED");
        account.setUpdateTime(row.getUpdateTime());
        return account;
    }

    public List<UserMailAccount> snapshot(Long userId) {
        List<UserMailAccount> accounts = new java.util.ArrayList<>();
        for (UserPrivateParam row : rows(userId)) {
            try { accounts.add(decode(row)); }
            catch (IllegalStateException invalid) {
                // Unsupported/corrupt ciphertext is never projected or returned as an account.
                // invalidProjectionIds retains this binding in the retry set without decoding other rows.
            }
        }
        return List.copyOf(accounts);
    }

    public List<UserMailAccount> active(Long userId) {
        return snapshot(userId).stream().filter(account -> "0".equals(account.getDeleteFlag())).toList();
    }

    public UserMailAccount find(Long userId, Long accountId) {
        return active(userId).stream().filter(account -> account.getAccountId().equals(accountId)).findFirst().orElse(null);
    }

    /** One stable account identity for each provider/connector, including repeated saves. */
    public void initialize(UserMailAccount account) {
        String code = MailProviderCatalog.require(account.getProviderCode()).getConnectorCode();
        ConnectorInfo connector = connectors.selectOne(new LambdaQueryWrapper<ConnectorInfo>()
            .eq(ConnectorInfo::getConnectorCode, code).eq(ConnectorInfo::getStatusCd, "00A").last("LIMIT 1"));
        if (connector == null) throw new IllegalArgumentException("邮箱连接器未配置");
        account.setConnectorId(connector.getConnectorId());
        account.setAccountId(connector.getConnectorId());
    }

    @Transactional(rollbackFor = Exception.class)
    public void save(UserMailAccount account) {
        String code = MailProviderCatalog.require(account.getProviderCode()).getConnectorCode();
        String key = key(account.getConnectorId());
        String source = code;
        UserPrivateParam row = mapper.selectOne(new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getUserId, account.getUserId()).eq(UserPrivateParam::getParamKey, key)
            .eq(UserPrivateParam::getDeleteFlag, "0"));
        boolean create = row == null;
        if (create) {
            row = new UserPrivateParam();
            row.setParamId(sequenceService.nextVal());
            row.setUserId(account.getUserId());
            row.setParamKey(key);
            row.setParamSource("CONNECTOR");
            row.setSourceRef(source);
            row.setDeleteFlag("0");
            row.setCreateBy(account.getUserId());
            row.setCreateTime(new Date());
        } else if (!isPrivateMailParam(row) || !source.equals(row.getSourceRef())) {
            throw new IllegalArgumentException("邮箱参数名称已被其他配置占用");
        }
        row.setStatus("0".equals(account.getDeleteFlag()) ? "NORMAL" : "DISABLED");
        row.setParamValueCipher("0".equals(account.getDeleteFlag()) ? Sm4Util.encrypt(encode(account)) : "");
        row.setParamValueLast4("");
        row.setDescription("系统托管邮箱配置：" + account.getProviderCode());
        row.setUpdateBy(account.getUserId());
        row.setUpdateTime(new Date());
        if (create) {
            if (mapper.insertConnectorParamIgnoreConflict(row) != 1) {
                throw new IllegalStateException("邮箱配置已并发创建，请重试");
            }
        } else if (mapper.updateById(row) != 1) {
            throw new IllegalStateException("邮箱配置保存失败");
        }
    }

    @Transactional(rollbackFor = Exception.class)
    public boolean updateCheck(UserMailAccount account, String observedStatus, Date observedTime) {
        for (UserPrivateParam row : rows(account.getUserId())) {
            if (!key(account.getAccountId()).equals(row.getParamKey())) continue;
            UserMailAccount current = decode(row);
            if (!account.getAccountId().equals(current.getAccountId()) || !"0".equals(current.getDeleteFlag())) continue;
            if (!java.util.Objects.equals(observedStatus, current.getStatus())
                    || !java.util.Objects.equals(observedTime, row.getUpdateTime())) return false;
            LambdaUpdateWrapper<UserPrivateParam> update = new LambdaUpdateWrapper<UserPrivateParam>()
                .eq(UserPrivateParam::getParamId, row.getParamId()).eq(UserPrivateParam::getUserId, account.getUserId())
                .eq(UserPrivateParam::getStatus, "NORMAL").eq(UserPrivateParam::getParamValueCipher, row.getParamValueCipher())
                .set(UserPrivateParam::getParamValueCipher, Sm4Util.encrypt(encode(account)))
                .set(UserPrivateParam::getUpdateBy, account.getUserId())
                .set(UserPrivateParam::getUpdateTime, new Date());
            if (row.getUpdateTime() == null) update.isNull(UserPrivateParam::getUpdateTime);
            else update.eq(UserPrivateParam::getUpdateTime, row.getUpdateTime());
            return mapper.update(null, update) == 1;
        }
        return false;
    }

    public Set<Long> ids(Long userId) {
        return rows(userId).stream().map(row -> Long.valueOf(row.getParamKey().substring(KEY_PREFIX.length())))
            .collect(java.util.stream.Collectors.toSet());
    }

    public Set<Long> invalidProjectionIds(Long userId) {
        Set<Long> invalid = new LinkedHashSet<>();
        for (UserPrivateParam row : rows(userId)) {
            try { decode(row); }
            catch (IllegalStateException e) {
                invalid.add(Long.valueOf(row.getParamKey().substring(KEY_PREFIX.length())));
            }
        }
        return invalid;
    }

    public String connectorCode(Long userId, Long connectorId) {
        return rows(userId).stream().filter(row -> key(connectorId).equals(row.getParamKey()))
            .map(UserPrivateParam::getSourceRef).findFirst().orElse(null);
    }

    /** Independent post-commit status write; CAS protects concurrent reauthorization/revocation. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Set<Long> projectionStatus(Long userId, Set<Long> ids, boolean failed) {
        Set<Long> changed = new LinkedHashSet<>();
        for (UserPrivateParam row : rows(userId)) {
            Long connectorId = Long.valueOf(row.getParamKey().substring(KEY_PREFIX.length()));
            if (!ids.contains(connectorId) || !"NORMAL".equals(row.getStatus())) continue;
            UserMailAccount account;
            try { account = decode(row); }
            catch (IllegalStateException invalid) { continue; }
            // A successful file write is not a successful remote connection check.
            if (!failed && !"PENDING".equals(account.getStatus()) && !"PROJECTION_FAILED".equals(account.getStatus())) continue;
            String status = failed ? "PROJECTION_FAILED" : MailAccountProjectionStateService.expectedProjectionStatus(account);
            if (status.equals(account.getStatus())) continue;
            account.setStatus(status);
            int count = mapper.update(null, new LambdaUpdateWrapper<UserPrivateParam>()
                .eq(UserPrivateParam::getParamId, row.getParamId()).eq(UserPrivateParam::getUserId, userId)
                .eq(UserPrivateParam::getStatus, "NORMAL")
                .eq(UserPrivateParam::getParamValueCipher, row.getParamValueCipher())
                .set(UserPrivateParam::getParamValueCipher, Sm4Util.encrypt(encode(account)))
                .set(UserPrivateParam::getUpdateTime, new Date()));
            if (count == 1) changed.add(account.getAccountId());
        }
        return changed;
    }

    public MailAccountProjectionStateService.ProjectionUserBatch scan(long cursor, int limit) {
        int bounded = Math.max(1, Math.min(limit, 100));
        List<UserPrivateParam> rows = mapper.selectList(new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getParamSource, "CONNECTOR").eq(UserPrivateParam::getDeleteFlag, "0")
            .likeRight(UserPrivateParam::getParamKey, "MAIL_")
            .gt(UserPrivateParam::getParamId, cursor).orderByAsc(UserPrivateParam::getParamId)
            .last("LIMIT " + bounded));
        return new MailAccountProjectionStateService.ProjectionUserBatch(
            rows.stream().filter(MailPrivateParamStore::isPrivateMailParam).map(UserPrivateParam::getUserId)
                .collect(java.util.stream.Collectors.toSet()),
            rows.isEmpty() ? cursor : rows.getLast().getParamId(), rows.size() == bounded);
    }
}
