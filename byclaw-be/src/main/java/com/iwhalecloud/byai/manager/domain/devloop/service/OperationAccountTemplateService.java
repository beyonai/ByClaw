package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.util.List;

/** 根据连接器账号模板初始化用户级运营账号。 */
@Slf4j
@Service
public class OperationAccountTemplateService {

    @Autowired
    private ConnectorInfoService connectorInfoService;

    @Autowired
    private OperationAccountService operationAccountService;

    /** 首次访问时创建所有缺失的用户级模板账号，已有或已删除的历史账号均不重建。 */
    @Transactional(rollbackFor = Exception.class)
    public void ensureDefaultAccounts(Long userId) {
        if (userId == null) {
            return;
        }
        List<ConnectorInfo> templates = connectorInfoService.listAccountTemplatesForUpdate();
        if (templates == null) {
            return;
        }
        for (ConnectorInfo template : templates) {
            createIfMissing(userId, template);
        }
    }

    private void createIfMissing(Long userId, ConnectorInfo template) {
        AccountTemplate values = parseTemplate(template);
        String connectorCode = template == null ? null : trim(template.getConnectorCode());
        if (values == null || connectorCode == null
            || operationAccountService.hasGlobalTemplateHistory(userId, connectorCode)) {
            return;
        }
        OperationAccount account = new OperationAccount();
        account.setProjectId(null);
        account.setPlatformCode(values.platformCode());
        account.setAccountName(values.accountName());
        account.setAccountCode(values.accountCode());
        account.setCustomUrl(values.customUrl());
        account.setTemplateConnectorCode(connectorCode);
        account.setCreateBy(userId);
        operationAccountService.create(account);
    }

    private AccountTemplate parseTemplate(ConnectorInfo template) {
        if (template == null || !"ACCOUNT_TEMPLATE".equals(template.getConnectorType())) {
            return null;
        }
        try {
            JSONObject root = JSON.parseObject(template.getRequestConfig());
            JSONObject config = root == null ? null : root.getJSONObject("operationAccount");
            if (config == null) {
                log.warn("运营账号模板配置缺少 operationAccount，connectorCode={}", template.getConnectorCode());
                return null;
            }
            String platformCode = trim(config.getString("platformCode"));
            String accountName = trim(config.getString("accountName"));
            String accountCode = trim(config.getString("accountCode"));
            String customUrl = trim(config.getString("customUrl"));
            if (!isValidTemplateAccount(platformCode, accountName, accountCode, customUrl)) {
                log.warn("运营账号模板配置无效，connectorCode={}", template.getConnectorCode());
                return null;
            }
            return new AccountTemplate(platformCode, accountName, accountCode, customUrl);
        } catch (RuntimeException e) {
            log.warn("运营账号模板配置解析失败，connectorCode={}", template.getConnectorCode());
            return null;
        }
    }

    private static boolean isValidTemplateAccount(
            String platformCode, String accountName, String accountCode, String customUrl) {
        if (platformCode == null || platformCode.isEmpty() || platformCode.length() > 20
            || accountName == null || accountName.isEmpty() || accountName.length() > 100) {
            return false;
        }
        if ("CustomLink".equals(platformCode)) {
            return accountCode != null && accountCode.isEmpty()
                && customUrl != null && customUrl.length() <= 500 && isSafeWebUrl(customUrl);
        }
        return accountCode != null && !accountCode.isEmpty() && accountCode.length() <= 100
            && (customUrl == null || customUrl.isEmpty());
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static boolean isSafeWebUrl(String value) {
        if (value == null) {
            return false;
        }
        try {
            URI uri = URI.create(value);
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private record AccountTemplate(
        String platformCode,
        String accountName,
        String accountCode,
        String customUrl
    ) {
    }
}
