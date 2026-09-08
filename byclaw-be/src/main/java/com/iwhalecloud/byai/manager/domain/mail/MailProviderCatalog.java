package com.iwhalecloud.byai.manager.domain.mail;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;
import org.apache.commons.lang3.StringUtils;

/**
 * 邮箱服务商的唯一目录定义。
 */
public final class MailProviderCatalog {

    public static final String CUSTOM_IMAP = "custom-imap";

    private static final List<String> NATIVE_CAPABILITIES = List.of(
        "list", "get", "search", "downloadAttachment", "send", "reply", "delete"
    );
    private static final List<String> IMAP_CAPABILITIES = List.of(
        "list", "get", "search", "downloadAttachment", "send", "reply"
    );

    private static final List<MailProviderVO> PROVIDERS = List.of(
        nativeProvider("gmail", "Gmail", "Gmail API", "OAUTH2", null, null, "gmail-mail", false,
            List.of("AUTHORIZE_OAUTH2")),
        nativeProvider("fastmail", "Fastmail", "JMAP", "API_TOKEN", null, null, null, false,
            List.of("CREATE_API_TOKEN")),
        provider("qq", "QQ Mail", "IMAP_SMTP", "APP_PASSWORD",
            server("imap.qq.com", 993), server("smtp.qq.com", 465), null, false,
            List.of("ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE")),
        provider("netease-163", "NetEase 163 Mail", "IMAP_SMTP", "APP_PASSWORD",
            server("imap.163.com", 993), server("smtp.163.com", 465), null, false,
            List.of("ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE")),
        provider("aliyun-mail", "Aliyun Mail", "IMAP_SMTP", "APP_PASSWORD",
            server("imap.qiye.aliyun.com", 993), server("smtp.qiye.aliyun.com", 465), null, false,
            List.of("ADMIN_ENABLE_THIRD_PARTY_CLIENT", "USE_SECURITY_PASSWORD")),
        nativeProvider("microsoft-365", "Microsoft 365", "GRAPH", "OAUTH2", null, null,
            "microsoft-mail", false, List.of("AUTHORIZE_OAUTH2")),
        conditionalNativeProvider("iwhalecloud", "iWhaleCloud", "EXCHANGE_EWS_OWA", "BROWSER_SSO",
            List.of("SIGN_IN_WITH_BROWSER_OR_CONFIGURE_EWS")),
        provider(CUSTOM_IMAP, "Custom IMAP", "IMAP_SMTP", "APP_PASSWORD", null, null, null, true,
            List.of("PROVIDE_IMAP_SMTP_SETTINGS", "USE_APP_PASSWORD"))
    );

    private MailProviderCatalog() {
    }

    public static List<MailProviderVO> list() {
        return PROVIDERS;
    }

    public static MailProviderVO resolve(String providerCode) {
        return require(StringUtils.defaultIfBlank(providerCode, CUSTOM_IMAP).trim());
    }

    public static MailProviderVO require(String providerCode) {
        return PROVIDERS.stream()
            .filter(provider -> provider.getCode().equals(providerCode))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("未知邮箱服务商: " + providerCode));
    }

    public static Optional<MailProviderVO> findByConnectorCode(String connectorCode) {
        return PROVIDERS.stream()
            .filter(provider -> StringUtils.equals(provider.getConnectorCode(), connectorCode))
            .findFirst();
    }

    private static MailProviderVO provider(String code, String name, String transport, String authType,
        MailServerConfigDTO imap, MailServerConfigDTO smtp, String connectorCode,
        boolean advancedServerEditable, List<String> setupRequirements) {
        Map<String, String> status = yesStatus(IMAP_CAPABILITIES);
        status.put("delete", "CONDITIONAL_MOVE_OR_UIDPLUS");
        return new MailProviderVO(code, name, transport, authType, imap, smtp, connectorCode,
            IMAP_CAPABILITIES, status, setupRequirements, advancedServerEditable);
    }

    private static MailProviderVO nativeProvider(String code, String name, String transport, String authType,
        MailServerConfigDTO imap, MailServerConfigDTO smtp, String connectorCode,
        boolean advancedServerEditable, List<String> setupRequirements) {
        return new MailProviderVO(code, name, transport, authType, imap, smtp, connectorCode,
            NATIVE_CAPABILITIES, yesStatus(NATIVE_CAPABILITIES), setupRequirements, advancedServerEditable);
    }

    private static MailProviderVO conditionalNativeProvider(String code, String name, String transport,
        String authType, List<String> setupRequirements) {
        Map<String, String> status = new LinkedHashMap<>();
        NATIVE_CAPABILITIES.forEach(capability ->
            status.put(capability, "CONDITIONAL_EWS_ENTERPRISE_AUTH_OR_BROWSER_SSO"));
        return new MailProviderVO(code, name, transport, authType, null, null, null,
            NATIVE_CAPABILITIES, status, setupRequirements, false);
    }

    private static Map<String, String> yesStatus(List<String> capabilities) {
        Map<String, String> status = new LinkedHashMap<>();
        capabilities.forEach(capability -> status.put(capability, "YES"));
        return status;
    }

    private static MailServerConfigDTO server(String host, int port) {
        MailServerConfigDTO server = new MailServerConfigDTO();
        server.setHost(host);
        server.setPort(port);
        server.setEncryption("tls");
        return server;
    }
}
