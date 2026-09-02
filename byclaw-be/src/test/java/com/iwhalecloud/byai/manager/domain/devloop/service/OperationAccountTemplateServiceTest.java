package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OperationAccountTemplateServiceTest {

    @Mock
    private ConnectorInfoService connectorInfoService;

    @Mock
    private OperationAccountService operationAccountService;

    @InjectMocks
    private OperationAccountTemplateService service;

    @Test
    void createsWechatAccountFromLockedTemplateOnFirstUse() {
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web"))
            .thenReturn(false, false);
        when(connectorInfoService.findByCodeForUpdate("weixin-official-web"))
            .thenReturn(template(validRequestConfig()));

        service.ensureWechatOfficialWebAccount(10L);

        ArgumentCaptor<OperationAccount> captor = ArgumentCaptor.forClass(OperationAccount.class);
        verify(operationAccountService).create(captor.capture());
        OperationAccount account = captor.getValue();
        assertThat(account.getProjectId()).isNull();
        assertThat(account.getCreateBy()).isEqualTo(10L);
        assertThat(account.getPlatformCode()).isEqualTo("CustomLink");
        assertThat(account.getAccountName()).isEqualTo("微信公众号");
        assertThat(account.getAccountCode()).isEmpty();
        assertThat(account.getCustomUrl()).isEqualTo("https://mp.weixin.qq.com/");
        assertThat(JSON.parseObject(account.getConfig()).getString("connectorCode"))
            .isEqualTo("weixin-official-web");
    }

    @Test
    void skipsLockAndCreateWhenTemplateHistoryAlreadyExists() {
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web")).thenReturn(true);

        service.ensureWechatOfficialWebAccount(10L);

        verifyNoInteractions(connectorInfoService);
        verify(operationAccountService, never()).create(any());
    }

    @Test
    void skipsCreateWhenLockedRecheckFindsConcurrentInsert() {
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web"))
            .thenReturn(false, true);
        when(connectorInfoService.findByCodeForUpdate("weixin-official-web"))
            .thenReturn(template(validRequestConfig()));

        service.ensureWechatOfficialWebAccount(10L);

        verify(operationAccountService, never()).create(any());
    }

    @Test
    void skipsMissingTemplate() {
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web")).thenReturn(false);
        when(connectorInfoService.findByCodeForUpdate("weixin-official-web")).thenReturn(null);

        service.ensureWechatOfficialWebAccount(10L);

        verify(operationAccountService, never()).create(any());
    }

    @Test
    void skipsConnectorThatIsNotAnAccountTemplate() {
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web")).thenReturn(false);
        ConnectorInfo connector = template(validRequestConfig());
        connector.setConnectorType("SYSTEM");
        when(connectorInfoService.findByCodeForUpdate("weixin-official-web")).thenReturn(connector);

        service.ensureWechatOfficialWebAccount(10L);

        verify(operationAccountService, never()).create(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{}",
        "{\"operationAccount\":{\"platformCode\":\"WeChatAccount\",\"accountName\":\"微信公众号\",\"accountCode\":\"\",\"customUrl\":\"https://mp.weixin.qq.com/\"}}",
        "{\"operationAccount\":{\"platformCode\":\"CustomLink\",\"accountName\":\" \",\"accountCode\":\"\",\"customUrl\":\"https://mp.weixin.qq.com/\"}}",
        "{\"operationAccount\":{\"platformCode\":\"CustomLink\",\"accountName\":\"微信公众号\",\"accountCode\":\"unexpected\",\"customUrl\":\"https://mp.weixin.qq.com/\"}}",
        "{\"operationAccount\":{\"platformCode\":\"CustomLink\",\"accountName\":\"微信公众号\",\"accountCode\":\"\",\"customUrl\":\"javascript:alert(1)\"}}"
    })
    void skipsInvalidTemplateConfig(String requestConfig) {
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web")).thenReturn(false);
        when(connectorInfoService.findByCodeForUpdate("weixin-official-web"))
            .thenReturn(template(requestConfig));

        service.ensureWechatOfficialWebAccount(10L);

        verify(operationAccountService, never()).create(any());
    }

    private static ConnectorInfo template(String requestConfig) {
        ConnectorInfo template = new ConnectorInfo();
        template.setConnectorCode("weixin-official-web");
        template.setConnectorType("ACCOUNT_TEMPLATE");
        template.setRequestConfig(requestConfig);
        return template;
    }

    private static String validRequestConfig() {
        return """
            {"operationAccount":{"platformCode":"CustomLink","accountName":"微信公众号",
             "accountCode":"","customUrl":"https://mp.weixin.qq.com/"}}
            """;
    }
}
