package com.iwhalecloud.byai.manager.application.service.user;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.mapper.users.UserMailAccountMapper;
import com.iwhalecloud.byai.manager.vo.users.UserMailAccountVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户个人邮箱账号管理，只做账号配置维护，不做 IMAP/SMTP 可用性测试。
 */
@Service
public class UserMailAccountApplicationService {

    private static final Logger log = LoggerFactory.getLogger(UserMailAccountApplicationService.class);

    private static final String REDIS_KEY_PREFIX = "byai:user:mail_account:";

    private static final String YES = "Y";

    private static final String NO = "N";

    private static final String NORMAL = "NORMAL";

    private static final String DELETED = "DELETED";

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final String DELETE_FLAG_DELETED = "1";

    @Autowired
    private UserMailAccountMapper userMailAccountMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 查询当前用户的个人邮箱账号列表。
     */
    public List<UserMailAccountVO> list() {
        Long userId = currentUserId();
        List<UserMailAccount> accounts = listAccounts(userId);
        refreshMailAccountCache(userId, currentUserCode(), accounts);
        return accounts
            .stream()
            .map(this::toVo)
            .toList();
    }

    /**
     * 新增或更新邮箱账号。授权码只在入参非空时覆盖，避免编辑时因不回显而误清空。
     */
    @Transactional(rollbackFor = Exception.class)
    public UserMailAccountVO save(UserMailAccountDTO request) {
        validateSaveRequest(request);
        Long userId = currentUserId();
        Date now = new Date();
        boolean create = request.getAccountId() == null;
        UserMailAccount entity = create ? new UserMailAccount() : getOwnedAccount(userId, request.getAccountId());
        if (create) {
            entity.setAccountId(sequenceService.nextVal());
            entity.setUserId(userId);
            entity.setCreateBy(userId);
            entity.setCreateTime(now);
            entity.setDeleteFlag(DELETE_FLAG_NORMAL);
            entity.setStatus(NORMAL);
        }

        entity.setAccountName(StringUtils.trim(request.getName()));
        entity.setEmail(StringUtils.trim(request.getEmail()));
        entity.setDisplayName(StringUtils.trim(resolveDisplayName(request)));
        entity.setImapHost(StringUtils.trim(request.getImap().getHost()));
        entity.setImapPort(request.getImap().getPort());
        entity.setImapEncryption(normalizeEncryption(request.getImap().getEncryption()));
        entity.setSmtpHost(StringUtils.trim(request.getSmtp().getHost()));
        entity.setSmtpPort(request.getSmtp().getPort());
        entity.setSmtpEncryption(normalizeEncryption(request.getSmtp().getEncryption()));
        entity.setUpdateBy(userId);
        entity.setUpdateTime(now);

        String authCode = resolveAuthCode(request);
        if (StringUtils.isNotBlank(authCode)) {
            String trimmedAuthCode = authCode.trim();
            entity.setAuthCodeCipher(Sm4Util.encrypt(trimmedAuthCode));
            entity.setAuthCodeLast4(last4(trimmedAuthCode));
        }
        else if (create) {
            throw new IllegalArgumentException("新增邮箱账号时授权码不能为空");
        }

        boolean shouldDefault = Boolean.TRUE.equals(request.getDefaultAccount()) || isFirstAccount(userId, entity.getAccountId());
        entity.setDefaultFlag(shouldDefault ? YES : NO);
        if (shouldDefault) {
            clearOtherDefault(userId, entity.getAccountId(), now);
        }

        if (create) {
            userMailAccountMapper.insert(entity);
        }
        else {
            userMailAccountMapper.updateById(entity);
        }
        refreshMailAccountCache(userId, currentUserCode());
        return toVo(entity);
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
        refreshMailAccountCache(userId, currentUserCode());
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
        refreshMailAccountCache(userId, currentUserCode());
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

    private void validateSaveRequest(UserMailAccountDTO request) {
        if (request == null) {
            throw new IllegalArgumentException("邮箱账号配置不能为空");
        }
        if (StringUtils.isBlank(request.getName())) {
            throw new IllegalArgumentException("邮箱账号名称不能为空");
        }
        if (StringUtils.isBlank(request.getEmail()) || !request.getEmail().contains("@")) {
            throw new IllegalArgumentException("邮箱地址格式不正确");
        }
        validateServerConfig(request.getImap(), "IMAP");
        validateServerConfig(request.getSmtp(), "SMTP");
    }

    private void validateServerConfig(MailServerConfigDTO config, String label) {
        if (config == null || StringUtils.isBlank(config.getHost()) || config.getPort() == null) {
            throw new IllegalArgumentException(label + "服务器配置不能为空");
        }
        if (config.getPort() <= 0 || config.getPort() > 65535) {
            throw new IllegalArgumentException(label + "端口范围不正确");
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
        UserMailAccountVO vo = new UserMailAccountVO();
        vo.setAccountId(account.getAccountId());
        vo.setName(account.getAccountName());
        vo.setEmail(account.getEmail());
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

    private Long currentUserId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new IllegalStateException("当前用户未登录");
        }
        return userId;
    }

    private String currentUserCode() {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalStateException("当前用户编码为空");
        }
        return userCode;
    }

    /**
     * 同步用户个人邮箱运行时配置到 Redis。
     *
     * key: byai:user:mail_account:{userCode}
     * value: {"accounts":[{"name":"QQ邮箱","email":"xx@qq.com","display_name":"xx","default":true,...}]}
     */
    private void refreshMailAccountCache(Long userId, String userCode) {
        refreshMailAccountCache(userId, userCode, listAccounts(userId));
    }

    private void refreshMailAccountCache(Long userId, String userCode, List<UserMailAccount> accounts) {
        try {
            stringRedisTemplate.opsForValue().set(buildMailAccountRedisKey(userCode), buildMailAccountCacheJson(accounts));
        }
        catch (Exception ex) {
            log.warn("同步用户个人邮箱配置到Redis失败，userId={}，userCode={}，reason={}", userId, userCode, ex.getMessage(), ex);
        }
    }

    private String buildMailAccountCacheJson(List<UserMailAccount> accounts) throws JsonProcessingException {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("accounts", accounts.stream().map(this::toCacheAccount).toList());
        return objectMapper.writeValueAsString(root);
    }

    private Map<String, Object> toCacheAccount(UserMailAccount account) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", account.getAccountName());
        item.put("email", account.getEmail());
        item.put("display_name", account.getDisplayName());
        item.put("default", YES.equals(account.getDefaultFlag()));
        item.put("imap", toCacheServer(account.getImapHost(), account.getImapPort(), account.getImapEncryption()));
        item.put("smtp", toCacheServer(account.getSmtpHost(), account.getSmtpPort(), account.getSmtpEncryption()));
        item.put("auth_code", decryptAuthCode(account));
        return item;
    }

    private Map<String, Object> toCacheServer(String host, Integer port, String encryption) {
        Map<String, Object> server = new LinkedHashMap<>();
        server.put("host", host);
        server.put("port", port);
        server.put("encryption", encryption);
        return server;
    }

    private String decryptAuthCode(UserMailAccount account) {
        if (StringUtils.isBlank(account.getAuthCodeCipher())) {
            return "";
        }
        try {
            return Sm4Util.decrypt(account.getAuthCodeCipher());
        }
        catch (Exception ex) {
            log.warn("个人邮箱授权码解密失败，accountId={}，reason={}", account.getAccountId(), ex.getMessage());
            return "";
        }
    }

    public static String buildMailAccountRedisKey(String userCode) {
        return REDIS_KEY_PREFIX + userCode;
    }

    private String resolveDisplayName(UserMailAccountDTO request) {
        return StringUtils.defaultIfBlank(request.getDisplayName(), request.getDisplayNameSnake());
    }

    private String resolveAuthCode(UserMailAccountDTO request) {
        return StringUtils.defaultIfBlank(request.getAuthCode(), request.getAuthCodeSnake());
    }

    private String normalizeEncryption(String encryption) {
        return StringUtils.defaultIfBlank(encryption, "tls").trim().toLowerCase();
    }

    private String last4(String value) {
        String text = StringUtils.defaultString(value);
        return text.length() <= 4 ? text : text.substring(text.length() - 4);
    }
}
