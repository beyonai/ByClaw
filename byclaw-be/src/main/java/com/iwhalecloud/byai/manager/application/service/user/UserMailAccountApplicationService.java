package com.iwhalecloud.byai.manager.application.service.user;

import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO;
import com.iwhalecloud.byai.manager.domain.mail.MailAccountMetadataCacheService;
import com.iwhalecloud.byai.manager.domain.mail.MailAccountProjectionService;
import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckLeaseService;
import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckAdmissionService;
import com.iwhalecloud.byai.manager.domain.mail.MailProviderCatalog;
import com.iwhalecloud.byai.manager.domain.mail.MailRuntimeProbe;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.mapper.users.UserMailAccountMapper;
import com.iwhalecloud.byai.manager.vo.users.MailConnectionCheckResultVO;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;
import com.iwhalecloud.byai.manager.vo.users.UserMailAccountVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 用户个人邮箱账号管理；连接检查委托给隔离的邮件运行时。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@Service
public class UserMailAccountApplicationService {

    private static final Logger log = LoggerFactory.getLogger(UserMailAccountApplicationService.class);

    private static final String YES = "Y";

    private static final String NO = "N";

    private static final String NORMAL = "NORMAL";

    private static final String AUTH_REQUIRED = "AUTH_REQUIRED";

    private static final String UNAVAILABLE = "UNAVAILABLE";

    private static final String DELETED = "DELETED";

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final String DELETE_FLAG_DELETED = "1";

    private static final Set<String> SUPPORTED_ENCRYPTIONS = Set.of("tls", "starttls", "ssl");

    @Autowired
    private UserMailAccountMapper userMailAccountMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private MailAccountProjectionService mailAccountProjectionService;

    @Autowired
    private MailAccountMetadataCacheService mailAccountMetadataCacheService;

    @Autowired
    private MailRuntimeProbe mailRuntimeProbe;

    @Autowired
    private MailConnectionCheckLeaseService mailConnectionCheckLeaseService;

    @Autowired
    private MailConnectionCheckAdmissionService mailConnectionCheckAdmissionService;

    /**
     * 查询当前用户的个人邮箱账号列表。
     */
    public List<UserMailAccountVO> list() {
        Long userId = currentUserId();
        List<UserMailAccount> accounts = listAccounts(userId);
        mailAccountMetadataCacheService.refresh(userId);
        return accounts
            .stream()
            .map(this::toVo)
            .toList();
    }

    public List<MailProviderVO> providers() {
        return MailProviderCatalog.list();
    }

    /** Runs the external probe without holding a database transaction. */
    public MailConnectionCheckResultVO check(Long accountId) {
        if (accountId == null || accountId <= 0) {
            throw new IllegalArgumentException("邮箱账号ID不能为空");
        }
        Long userId = currentUserId();
        UserMailAccount account = getOwnedAccount(userId, accountId);
        if (DELETED.equals(account.getStatus())) {
            throw new IllegalArgumentException("邮箱账号不存在或无权限访问");
        }
        String observedStatus = account.getStatus();
        if (!isReadyForConnectionCheck(account, observedStatus)) {
            throw new IllegalStateException("邮箱账号尚未准备好连接检查");
        }
        Date observedUpdateTime = account.getUpdateTime();
        try (MailConnectionCheckAdmissionService.Admission admission =
                mailConnectionCheckAdmissionService.acquire(userId)) {
            MailConnectionCheckLeaseService.Lease lease = mailConnectionCheckLeaseService.tryAcquire(accountId)
                .orElseThrow(() -> new MailConnectionCheckAdmissionService.BusyException());
            try {
                MailRuntimeProbe.Result probeResult;
                try {
                    probeResult = mailRuntimeProbe.check(userId, accountId);
                } catch (RuntimeException e) {
                    throw new IllegalStateException("邮箱服务暂时不可用，请稍后重试");
                }
                admission.assertOwnedAndRenew();
                mailConnectionCheckLeaseService.assertOwnedAndRenew(lease);
                Date checkedAt = new Date();
                String status = probeResult.status().name();
                LambdaUpdateWrapper<UserMailAccount> update = new LambdaUpdateWrapper<UserMailAccount>()
                    .set(UserMailAccount::getStatus, status)
                    .set(UserMailAccount::getLastCheckTime, checkedAt)
                    .set(UserMailAccount::getUpdateBy, userId)
                    .set(UserMailAccount::getUpdateTime, checkedAt)
                    .eq(UserMailAccount::getAccountId, accountId)
                    .eq(UserMailAccount::getUserId, userId)
                    .eq(UserMailAccount::getDeleteFlag, DELETE_FLAG_NORMAL)
                    .eq(UserMailAccount::getStatus, observedStatus);
                if (observedUpdateTime == null) {
                    update.isNull(UserMailAccount::getUpdateTime);
                }
                else {
                    update.eq(UserMailAccount::getUpdateTime, observedUpdateTime);
                }
                if (userMailAccountMapper.update(null, update) != 1) {
                    throw new IllegalStateException("邮箱账号已发生变化，请重试");
                }
                scheduleStateRefresh(userId, accountId);
                MailConnectionCheckResultVO result = new MailConnectionCheckResultVO();
                result.setConnectionState(switch (probeResult.status()) {
                    case NORMAL, PARTIAL -> "READY";
                    case AUTH_REQUIRED, UNAVAILABLE -> "FAILED";
                });
                result.setLastCheckTime(checkedAt);
                result.setStatus(status);
                result.setCapabilityStatus(probeResult.capabilityStatus());
                return result;
            } finally {
                mailConnectionCheckLeaseService.release(lease);
            }
        }
    }

    /**
     * 新增或更新邮箱账号。授权码只在入参非空时覆盖，避免编辑时因不回显而误清空。
     */
    @Transactional(rollbackFor = Exception.class)
    public UserMailAccountVO save(UserMailAccountDTO request) {
        validateBaseSaveRequest(request);
        Long userId = currentUserId();
        Date now = new Date();
        boolean create = request.getAccountId() == null;
        UserMailAccount entity = create ? new UserMailAccount() : getOwnedAccount(userId, request.getAccountId());
        MailProviderVO oldProvider = create ? null : MailProviderCatalog.resolve(entity.getProviderCode());
        MailProviderVO provider = resolveSaveProvider(request, entity, create);
        validateProviderRequest(request, provider);
        String selectedAuthType = resolveSelectedAuthType(request, provider);
        String authCode = resolveAuthCode(request);
        boolean authContextChanged = create || providerChanged(entity, oldProvider, provider, selectedAuthType);
        boolean resetProbeFailure = !create && isFreshApplicableSecret(selectedAuthType, authCode, entity)
            && Set.of(AUTH_REQUIRED, UNAVAILABLE).contains(entity.getStatus());
        if (requiresSecret(selectedAuthType) && authContextChanged && StringUtils.isBlank(authCode)) {
            throw new IllegalArgumentException("新增或切换邮箱服务商时授权码不能为空");
        }
        if (create) {
            entity.setAccountId(sequenceService.nextVal());
            entity.setUserId(userId);
            entity.setCreateBy(userId);
            entity.setCreateTime(now);
            entity.setDeleteFlag(DELETE_FLAG_NORMAL);
        }

        entity.setAccountName(StringUtils.trim(request.getName()));
        entity.setEmail(StringUtils.trim(request.getEmail()));
        entity.setDisplayName(StringUtils.trim(resolveDisplayName(request)));
        entity.setProviderCode(provider.getCode());
        entity.setAuthType(selectedAuthType);
        applyServerConfig(entity, provider, request);
        entity.setUpdateBy(userId);
        entity.setUpdateTime(now);

        if (requiresExternalAuthorization(selectedAuthType) && authContextChanged) {
            entity.setStatus(AUTH_REQUIRED);
            entity.setAuthCodeCipher(null);
            entity.setAuthCodeLast4(null);
            entity.setCredentialRef(null);
        }
        else if (StringUtils.isNotBlank(authCode)) {
            String trimmedAuthCode = authCode.trim();
            entity.setAuthCodeCipher(Sm4Util.encrypt(trimmedAuthCode));
            entity.setAuthCodeLast4(last4(trimmedAuthCode));
            if (authContextChanged || resetProbeFailure) {
                entity.setStatus(NORMAL);
                entity.setCredentialRef(null);
            }
        }
        else if (create) {
            entity.setStatus(requiresExternalAuthorization(selectedAuthType) ? AUTH_REQUIRED : NORMAL);
        }
        if ("KERBEROS".equals(selectedAuthType)) {
            entity.setAuthCodeCipher(null);
            entity.setAuthCodeLast4(null);
            entity.setCredentialRef(null);
            entity.setStatus(NORMAL);
        }
        mailAccountProjectionService.bindAvailableOAuth(entity);

        boolean shouldDefault = Boolean.TRUE.equals(request.getDefaultAccount()) || isFirstAccount(userId, entity.getAccountId());
        entity.setDefaultFlag(shouldDefault ? YES : NO);
        if (shouldDefault) {
            clearOtherDefault(userId, entity.getAccountId(), now);
        }

        if (create) {
            userMailAccountMapper.insert(entity);
        }
        else {
            updateSavedAccount(entity, userId);
        }
        scheduleStateRefresh(userId, entity.getAccountId());
        return toVo(entity);
    }

    /** Binds a connector-created account to its connector for precise lifecycle cleanup. */
    @Transactional(rollbackFor = Exception.class)
    public void bindConnector(Long accountId, Long connectorId, Long userId) {
        if (accountId == null || connectorId == null || userId == null) {
            throw new IllegalArgumentException("邮箱连接器绑定参数不能为空");
        }
        UserMailAccount account = userMailAccountMapper.selectOne(baseQuery(userId)
            .eq(UserMailAccount::getAccountId, accountId));
        if (account == null) {
            throw new IllegalArgumentException("邮箱账号不存在或无权限访问");
        }
        UserMailAccount update = new UserMailAccount();
        update.setAccountId(accountId);
        update.setConnectorId(connectorId);
        update.setUpdateBy(userId);
        update.setUpdateTime(new Date());
        if (userMailAccountMapper.updateById(update) != 1) {
            throw new IllegalStateException("邮箱连接器绑定失败");
        }
        mailAccountProjectionService.sync(userId, Set.of(accountId));
    }

    /**
     * 软删除邮箱账号；如果删除的是默认账号，自动把剩余最新账号设为默认。
     */
    @Transactional(rollbackFor = Exception.class)
    public Boolean delete(UserMailAccountDTO request) {
        Long accountId = request == null ? null : request.getAccountId();
        if (accountId == null) {
            throw new IllegalArgumentException("邮箱账号ID不能为空");
        }
        Long userId = currentUserId();
        UserMailAccount account = getOwnedAccount(userId, accountId);
        Date now = new Date();
        UserMailAccount update = new UserMailAccount();
        update.setAccountId(accountId);
        update.setStatus(DELETED);
        update.setDeleteFlag(DELETE_FLAG_DELETED);
        update.setDefaultFlag(NO);
        update.setUpdateBy(userId);
        update.setUpdateTime(now);
        userMailAccountMapper.updateById(update);
        if (YES.equals(account.getDefaultFlag())) {
            ensureOneDefault(userId, now);
        }
        scheduleStateRefresh(userId, accountId);
        return Boolean.TRUE;
    }

    /**
     * 设置默认邮箱账号，同一用户只保留一个默认账号。
     */
    @Transactional(rollbackFor = Exception.class)
    public UserMailAccountVO setDefault(UserMailAccountDTO request) {
        Long accountId = request == null ? null : request.getAccountId();
        if (accountId == null) {
            throw new IllegalArgumentException("邮箱账号ID不能为空");
        }
        Long userId = currentUserId();
        UserMailAccount account = getOwnedAccount(userId, accountId);
        Date now = new Date();
        clearOtherDefault(userId, accountId, now);
        UserMailAccount update = new UserMailAccount();
        update.setAccountId(accountId);
        update.setDefaultFlag(YES);
        update.setUpdateBy(userId);
        update.setUpdateTime(now);
        userMailAccountMapper.updateById(update);
        account.setDefaultFlag(YES);
        account.setUpdateTime(now);
        scheduleStateRefresh(userId, accountId);
        return toVo(account);
    }

    private List<UserMailAccount> listAccounts(Long userId) {
        return userMailAccountMapper.selectList(baseQuery(userId)
            .orderByDesc(UserMailAccount::getDefaultFlag)
            .orderByDesc(UserMailAccount::getUpdateTime)
            .orderByDesc(UserMailAccount::getCreateTime));
    }

    private LambdaQueryWrapper<UserMailAccount> baseQuery(Long userId) {
        return new LambdaQueryWrapper<UserMailAccount>()
            .eq(UserMailAccount::getUserId, userId)
            .eq(UserMailAccount::getDeleteFlag, DELETE_FLAG_NORMAL);
    }

    private UserMailAccount getOwnedAccount(Long userId, Long accountId) {
        UserMailAccount account = userMailAccountMapper.selectOne(baseQuery(userId)
            .eq(UserMailAccount::getAccountId, accountId));
        if (account == null) {
            throw new IllegalArgumentException("邮箱账号不存在或无权限访问");
        }
        return account;
    }

    private void validateBaseSaveRequest(UserMailAccountDTO request) {
        if (request == null) {
            throw new IllegalArgumentException("邮箱账号配置不能为空");
        }
        if (StringUtils.isBlank(request.getName())) {
            throw new IllegalArgumentException("邮箱账号名称不能为空");
        }
        if (StringUtils.isBlank(request.getEmail()) || !request.getEmail().contains("@")) {
            throw new IllegalArgumentException("邮箱地址格式不正确");
        }
    }

    private MailProviderVO resolveSaveProvider(UserMailAccountDTO request, UserMailAccount entity, boolean create) {
        String providerCode = request.getProviderCode();
        if (!create && StringUtils.isBlank(providerCode)) {
            providerCode = entity.getProviderCode();
        }
        return MailProviderCatalog.resolve(providerCode);
    }

    private void validateProviderRequest(UserMailAccountDTO request, MailProviderVO provider) {
        String requestedAuthType = StringUtils.trim(request.getAuthType());
        boolean iWhaleEnterprise = "iwhalecloud".equals(provider.getCode())
            && ("NTLM".equals(requestedAuthType) || "KERBEROS".equals(requestedAuthType));
        if (StringUtils.isNotBlank(requestedAuthType)
            && !provider.getAuthType().equals(requestedAuthType) && !iWhaleEnterprise) {
            throw new IllegalArgumentException("authType与邮箱服务商不一致");
        }
        if (provider.getAdvancedServerEditable()) {
            validateServerConfig(request.getImap(), "IMAP");
            validateServerConfig(request.getSmtp(), "SMTP");
        }
        if (requiresExternalAuthorization(resolveSelectedAuthType(request, provider))
            && StringUtils.isNotBlank(resolveAuthCode(request))) {
            throw new IllegalArgumentException("当前邮箱服务商不接受authCode，请完成外部授权");
        }
    }

    private String resolveSelectedAuthType(UserMailAccountDTO request, MailProviderVO provider) {
        return StringUtils.defaultIfBlank(request.getAuthType(), provider.getAuthType()).trim();
    }

    private boolean providerChanged(UserMailAccount entity, MailProviderVO oldProvider, MailProviderVO provider,
            String selectedAuthType) {
        String oldAuthType = StringUtils.defaultIfBlank(entity.getAuthType(), oldProvider.getAuthType());
        return !oldProvider.getCode().equals(provider.getCode()) || !oldAuthType.equals(selectedAuthType);
    }

    private void applyServerConfig(UserMailAccount entity, MailProviderVO provider, UserMailAccountDTO request) {
        MailServerConfigDTO imap = provider.getAdvancedServerEditable() ? request.getImap() : provider.getImap();
        MailServerConfigDTO smtp = provider.getAdvancedServerEditable() ? request.getSmtp() : provider.getSmtp();
        entity.setImapHost(imap == null ? null : StringUtils.trim(imap.getHost()));
        entity.setImapPort(imap == null ? null : imap.getPort());
        entity.setImapEncryption(imap == null ? null : normalizeEncryption(imap.getEncryption()));
        entity.setSmtpHost(smtp == null ? null : StringUtils.trim(smtp.getHost()));
        entity.setSmtpPort(smtp == null ? null : smtp.getPort());
        entity.setSmtpEncryption(smtp == null ? null : normalizeEncryption(smtp.getEncryption()));
    }

    private boolean requiresSecret(String authType) {
        return "APP_PASSWORD".equals(authType) || "API_TOKEN".equals(authType) || "NTLM".equals(authType);
    }

    private boolean requiresExternalAuthorization(String authType) {
        return "OAUTH2".equals(authType) || "BROWSER_SSO".equals(authType);
    }

    private boolean isReadyForConnectionCheck(UserMailAccount account, String status) {
        if (Set.of(NORMAL, "PARTIAL", UNAVAILABLE).contains(status)) {
            return true;
        }
        return AUTH_REQUIRED.equals(status)
            && "iwhalecloud".equals(account.getProviderCode())
            && Set.of("BROWSER_SSO", "KERBEROS").contains(account.getAuthType());
    }

    private void updateSavedAccount(UserMailAccount entity, Long userId) {
        userMailAccountMapper.update(null, new LambdaUpdateWrapper<UserMailAccount>()
            .set(UserMailAccount::getAccountName, entity.getAccountName())
            .set(UserMailAccount::getEmail, entity.getEmail())
            .set(UserMailAccount::getDisplayName, entity.getDisplayName())
            .set(UserMailAccount::getDefaultFlag, entity.getDefaultFlag())
            .set(UserMailAccount::getProviderCode, entity.getProviderCode())
            .set(UserMailAccount::getAuthType, entity.getAuthType())
            .set(UserMailAccount::getImapHost, entity.getImapHost())
            .set(UserMailAccount::getImapPort, entity.getImapPort())
            .set(UserMailAccount::getImapEncryption, entity.getImapEncryption())
            .set(UserMailAccount::getSmtpHost, entity.getSmtpHost())
            .set(UserMailAccount::getSmtpPort, entity.getSmtpPort())
            .set(UserMailAccount::getSmtpEncryption, entity.getSmtpEncryption())
            .set(UserMailAccount::getAuthCodeCipher, entity.getAuthCodeCipher())
            .set(UserMailAccount::getAuthCodeLast4, entity.getAuthCodeLast4())
            .set(UserMailAccount::getCredentialRef, entity.getCredentialRef())
            .set(UserMailAccount::getStatus, entity.getStatus())
            .set(UserMailAccount::getUpdateBy, entity.getUpdateBy())
            .set(UserMailAccount::getUpdateTime, entity.getUpdateTime())
            .eq(UserMailAccount::getAccountId, entity.getAccountId())
            .eq(UserMailAccount::getUserId, userId)
            .eq(UserMailAccount::getDeleteFlag, DELETE_FLAG_NORMAL));
    }

    private void validateServerConfig(MailServerConfigDTO config, String label) {
        if (config == null || StringUtils.isBlank(config.getHost()) || config.getPort() == null) {
            throw new IllegalArgumentException(label + "服务器配置不能为空");
        }
        if (config.getPort() <= 0 || config.getPort() > 65535) {
            throw new IllegalArgumentException(label + "端口范围不正确");
        }
        if (StringUtils.isBlank(config.getEncryption())) {
            throw new IllegalArgumentException(label + "加密方式不能为空");
        }
        String encryption = config.getEncryption().trim().toLowerCase(Locale.ROOT);
        if (!SUPPORTED_ENCRYPTIONS.contains(encryption)) {
            throw new IllegalArgumentException(label + "加密方式不支持");
        }
    }

    private boolean isFirstAccount(Long userId, Long currentAccountId) {
        return userMailAccountMapper.selectCount(baseQuery(userId)
            .ne(currentAccountId != null, UserMailAccount::getAccountId, currentAccountId)) == 0;
    }

    private void clearOtherDefault(Long userId, Long accountId, Date now) {
        userMailAccountMapper.update(null, new LambdaUpdateWrapper<UserMailAccount>()
            .set(UserMailAccount::getDefaultFlag, NO)
            .set(UserMailAccount::getUpdateTime, now)
            .eq(UserMailAccount::getUserId, userId)
            .eq(UserMailAccount::getDeleteFlag, DELETE_FLAG_NORMAL)
            .ne(UserMailAccount::getAccountId, accountId));
    }

    private void ensureOneDefault(Long userId, Date now) {
        UserMailAccount account = userMailAccountMapper.selectOne(baseQuery(userId)
            .orderByDesc(UserMailAccount::getUpdateTime)
            .orderByDesc(UserMailAccount::getCreateTime)
            .last("LIMIT 1"));
        if (account == null) {
            return;
        }
        account.setDefaultFlag(YES);
        account.setUpdateTime(now);
        account.setUpdateBy(userId);
        userMailAccountMapper.updateById(account);
    }

    private UserMailAccountVO toVo(UserMailAccount account) {
        MailProviderVO provider = MailProviderCatalog.resolve(account.getProviderCode());
        UserMailAccountVO vo = new UserMailAccountVO();
        vo.setAccountId(account.getAccountId());
        vo.setName(account.getAccountName());
        vo.setEmail(account.getEmail());
        vo.setProviderCode(provider.getCode());
        vo.setAuthType(StringUtils.defaultIfBlank(account.getAuthType(), provider.getAuthType()));
        vo.setCapabilities(provider.getCapabilities());
        vo.setCapabilityStatus(provider.getCapabilityStatus());
        vo.setSetupRequirements(provider.getSetupRequirements());
        vo.setConnectionState(connectionState(account.getStatus()));
        vo.setLastCheckTime(account.getLastCheckTime());
        vo.setDisplayName(account.getDisplayName());
        vo.setDefaultAccount(YES.equals(account.getDefaultFlag()));
        vo.setImap(server(account.getImapHost(), account.getImapPort(), account.getImapEncryption()));
        vo.setSmtp(server(account.getSmtpHost(), account.getSmtpPort(), account.getSmtpEncryption()));
        vo.setHasAuthCode(StringUtils.isNotBlank(account.getAuthCodeCipher()));
        vo.setAuthCodeLast4(account.getAuthCodeLast4());
        vo.setStatus(account.getStatus());
        vo.setUpdateTime(account.getUpdateTime());
        return vo;
    }

    private MailServerConfigDTO server(String host, Integer port, String encryption) {
        MailServerConfigDTO config = new MailServerConfigDTO();
        config.setHost(host);
        config.setPort(port);
        config.setEncryption(encryption);
        return config;
    }

    private String connectionState(String status) {
        return NORMAL.equals(status) || "PARTIAL".equals(status) ? "READY" : "FAILED";
    }

    private Long currentUserId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new IllegalStateException("当前用户未登录");
        }
        return userId;
    }

    private void scheduleStateRefresh(Long userId, Long changedAccountId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            projectAndRefresh(userId, changedAccountId);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                projectAndRefresh(userId, changedAccountId);
            }
        });
    }

    private void projectAndRefresh(Long userId, Long changedAccountId) {
        try {
            mailAccountProjectionService.sync(userId, Set.of(changedAccountId));
        } catch (RuntimeException ex) {
            log.warn("同步用户个人邮箱投影失败，userId={}，reason={}", userId, ex.getMessage());
        }
    }

    public static String buildMailAccountRedisKey(String userCode) {
        return MailAccountMetadataCacheService.buildRedisKey(userCode);
    }

    private String resolveDisplayName(UserMailAccountDTO request) {
        return StringUtils.defaultIfBlank(request.getDisplayName(), request.getDisplayNameSnake());
    }

    private String resolveAuthCode(UserMailAccountDTO request) {
        String value = StringUtils.defaultIfBlank(request.getAuthCode(), request.getAuthCodeSnake());
        return isMaskedSecret(value) ? null : value;
    }

    private boolean isFreshApplicableSecret(String authType, String submitted, UserMailAccount account) {
        if (!requiresSecret(authType) || StringUtils.isBlank(submitted)) {
            return false;
        }
        String cipher = account.getAuthCodeCipher();
        if (StringUtils.isBlank(cipher)) {
            return true;
        }
        try {
            return !submitted.trim().equals(Sm4Util.decrypt(cipher));
        } catch (RuntimeException ignored) {
            return true;
        }
    }

    private boolean isMaskedSecret(String value) {
        if (StringUtils.isBlank(value)) {
            return false;
        }
        String trimmed = value.trim();
        return trimmed.matches(".*(?:\\*{4,}|•{4,}).*");
    }

    private String normalizeEncryption(String encryption) {
        return StringUtils.defaultIfBlank(encryption, "tls").trim().toLowerCase(Locale.ROOT);
    }

    private String last4(String value) {
        String text = StringUtils.defaultString(value);
        return text.length() <= 4 ? text : text.substring(text.length() - 4);
    }
}
