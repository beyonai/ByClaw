package com.iwhalecloud.byai.manager.domain.mail;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;

/** Owns the independent database-to-Redis metadata refresh transaction. */
@Service
public class MailAccountMetadataCacheTransactionService {
    private static final String KEY_PREFIX = "byai:user:mail_account:";
    private final MailPrivateParamStore privateParamStore;
    private final LoginApplicationService loginApplicationService;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public MailAccountMetadataCacheTransactionService(MailPrivateParamStore privateParamStore,
            LoginApplicationService loginApplicationService, StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper) {
        this.privateParamStore = privateParamStore;
        this.loginApplicationService = loginApplicationService;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void refreshRequired(Long userId) throws JsonProcessingException {
        LoginInfo login = loginApplicationService.getLoginInfo(userId);
        if (login == null || login.getUserCode() == null || login.getUserCode().isBlank()) {
            throw new IllegalStateException("Unable to resolve mail metadata owner");
        }
        List<UserMailAccount> accounts = privateParamStore.active(userId);
        redisTemplate.opsForValue().set(buildRedisKey(login.getUserCode()), buildJson(accounts));
    }

    public String buildJson(List<UserMailAccount> accounts) throws JsonProcessingException {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("accounts", accounts.stream().map(this::item).toList());
        return objectMapper.writeValueAsString(root);
    }

    private Map<String, Object> item(UserMailAccount account) {
        MailProviderVO provider = MailProviderCatalog.resolve(account.getProviderCode());
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("account_id", account.getAccountId());
        item.put("name", account.getAccountName());
        item.put("email", account.getEmail());
        item.put("display_name", account.getDisplayName());
        item.put("provider_code", provider.getCode());
        item.put("auth_type", org.apache.commons.lang3.StringUtils.defaultIfBlank(
            account.getAuthType(), provider.getAuthType()));
        item.put("imap", server(account.getImapHost(), account.getImapPort(), account.getImapEncryption()));
        item.put("smtp", server(account.getSmtpHost(), account.getSmtpPort(), account.getSmtpEncryption()));
        item.put("status", account.getStatus());
        item.put("capabilities", provider.getCapabilities());
        item.put("capability_status", provider.getCapabilityStatus());
        item.put("setup_requirements", provider.getSetupRequirements());
        return item;
    }

    private Map<String, Object> server(String host, Integer port, String encryption) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("host", host);
        value.put("port", port);
        value.put("encryption", encryption);
        return value;
    }

    public static String buildRedisKey(String userCode) {
        return KEY_PREFIX + userCode;
    }
}
