package com.iwhalecloud.byai.manager.domain.devloop.service;

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

import java.util.List;

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
    void createsEveryMissingAccountTemplate() {
        when(connectorInfoService.listAccountTemplatesForUpdate())
            .thenReturn(List.of(
                template("weixin-official-web", validRequestConfig()),
                template("xiaohongshu-account", platformRequestConfig(
                    "Xiaohongshu", "小红书", "default-xiaohongshu"))));
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web")).thenReturn(false);
        when(operationAccountService.hasGlobalTemplateHistory(10L, "xiaohongshu-account")).thenReturn(false);

        service.ensureDefaultAccounts(10L);

        ArgumentCaptor<OperationAccount> captor = ArgumentCaptor.forClass(OperationAccount.class);
        verify(operationAccountService, org.mockito.Mockito.times(2)).create(captor.capture());
        assertThat(captor.getAllValues())
            .extracting(OperationAccount::getTemplateConnectorCode)
            .containsExactly("weixin-official-web", "xiaohongshu-account");
        OperationAccount customLink = captor.getAllValues().get(0);
        assertThat(customLink.getProjectId()).isNull();
        assertThat(customLink.getCreateBy()).isEqualTo(10L);
        assertThat(customLink.getPlatformCode()).isEqualTo("CustomLink");
        assertThat(customLink.getCustomUrl()).isEqualTo("https://mp.weixin.qq.com/");
        OperationAccount platformAccount = captor.getAllValues().get(1);
        assertThat(platformAccount.getPlatformCode()).isEqualTo("Xiaohongshu");
        assertThat(platformAccount.getAccountName()).isEqualTo("小红书");
        assertThat(platformAccount.getAccountCode()).isEqualTo("default-xiaohongshu");
        assertThat(platformAccount.getCustomUrl()).isNull();
    }

    @Test
    void skipsCreateWhenLockedTemplateHistoryAlreadyExists() {
        when(connectorInfoService.listAccountTemplatesForUpdate())
            .thenReturn(List.of(template("weixin-official-web", validRequestConfig())));
        when(operationAccountService.hasGlobalTemplateHistory(10L, "weixin-official-web"))
            .thenReturn(true);

        service.ensureDefaultAccounts(10L);

        verify(operationAccountService, never()).create(any());
    }

    @Test
    void skipsTemplateLookupForMissingUser() {
        service.ensureDefaultAccounts(null);

        verifyNoInteractions(connectorInfoService, operationAccountService);
    }

    @Test
    void skipsCreateWhenNoActiveTemplateExists() {
        when(connectorInfoService.listAccountTemplatesForUpdate()).thenReturn(List.of());

        service.ensureDefaultAccounts(10L);

        verify(operationAccountService, never()).create(any());
    }

    @Test
    void skipsConnectorThatIsNotAnAccountTemplate() {
        ConnectorInfo connector = template("weixin-official-web", validRequestConfig());
        connector.setConnectorType("SYSTEM");
        when(connectorInfoService.listAccountTemplatesForUpdate()).thenReturn(List.of(connector));

        service.ensureDefaultAccounts(10L);

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
        when(connectorInfoService.listAccountTemplatesForUpdate())
            .thenReturn(List.of(template("weixin-official-web", requestConfig)));

        service.ensureDefaultAccounts(10L);

        verify(operationAccountService, never()).create(any());
    }

    private static ConnectorInfo template(String connectorCode, String requestConfig) {
        ConnectorInfo template = new ConnectorInfo();
        template.setConnectorCode(connectorCode);
        template.setConnectorType("ACCOUNT_TEMPLATE");
        template.setRequestConfig(requestConfig);
        return template;
    }

    private static String validRequestConfig() {
        return validRequestConfig("微信公众号", "https://mp.weixin.qq.com/");
    }

    private static String validRequestConfig(String accountName, String customUrl) {
        return """
            {"operationAccount":{"platformCode":"CustomLink","accountName":"%s",
             "accountCode":"","customUrl":"%s"}}
            """.formatted(accountName, customUrl);
    }

    private static String platformRequestConfig(String platformCode, String accountName, String accountCode) {
        return """
            {"operationAccount":{"platformCode":"%s","accountName":"%s","accountCode":"%s"}}
            """.formatted(platformCode, accountName, accountCode);
    }
}
