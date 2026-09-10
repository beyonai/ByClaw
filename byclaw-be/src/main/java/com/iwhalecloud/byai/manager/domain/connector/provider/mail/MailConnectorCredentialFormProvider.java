package com.iwhalecloud.byai.manager.domain.connector.provider.mail;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

import javax.mail.Session;
import javax.mail.Store;
import javax.mail.Transport;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.mail.MailPrivateParamStore;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.domain.mail.MailProviderCatalog;

/** Verifies credentials without persistence; the binding transaction stores the encrypted configuration. */
@Component
public class MailConnectorCredentialFormProvider implements ConnectorCredentialFormProvider {

    private final MailPrivateParamStore privateParamStore;

    public MailConnectorCredentialFormProvider(MailPrivateParamStore privateParamStore) {
        this.privateParamStore = privateParamStore;
    }

    @Override
    public String providerCode() {
        return "mail-form";
    }

    @Override
    public CredentialFormVerification verify(String userId, ConnectorInfo connector, Map<String, String> credentials) {
        if (connector == null || credentials == null) {
            throw new IllegalArgumentException("邮箱连接器凭据不能为空");
        }
        String email = required(credentials, "email");
        String secret = credentials.getOrDefault("authCode", credentials.get("apiToken"));
        requiredValue(secret, "authCode");
        UserMailAccountDTO request = new UserMailAccountDTO();
        request.setName(connector.getConnectorName() + " - " + email);
        request.setEmail(email);
        request.setProviderCode(providerCodeFor(connector));
        request.setAuthType("fastmail-mail".equals(connector.getConnectorCode()) ? "API_TOKEN" : "APP_PASSWORD");
        request.setAuthCode(secret);
        if ("custom-imap-mail".equals(connector.getConnectorCode())) {
            request.setImap(server(credentials, "imapHost", "imapPort", "imapEncryption"));
            request.setSmtp(server(credentials, "smtpHost", "smtpPort", "smtpEncryption"));
        }
        probe(connector, request, secret);
        UserMailAccount account = new UserMailAccount();
        account.setAccountId(connector.getConnectorId());
        account.setConnectorId(connector.getConnectorId());
        account.setUserId(Long.valueOf(userId));
        account.setAccountName(request.getName());
        account.setEmail(email);
        account.setProviderCode(request.getProviderCode());
        account.setAuthType(request.getAuthType());
        account.setAuthCodeCipher(Sm4Util.encrypt(secret));
        account.setStatus("PENDING");
        account.setDeleteFlag("0");
        account.setDefaultFlag("N");
        if (request.getImap() != null) {
            account.setImapHost(request.getImap().getHost());
            account.setImapPort(request.getImap().getPort());
            account.setImapEncryption(request.getImap().getEncryption());
        }
        if (request.getSmtp() != null) {
            account.setSmtpHost(request.getSmtp().getHost());
            account.setSmtpPort(request.getSmtp().getPort());
            account.setSmtpEncryption(request.getSmtp().getEncryption());
        }
        Map<String, String> environment = new LinkedHashMap<>();
        environment.put(MailPrivateParamStore.key(connector.getConnectorId()), privateParamStore.encode(account));
        return new CredentialFormVerification(AuthorizationStatusResult.connected(
            String.valueOf(account.getAccountId()), email, CredentialState.READY,
            CredentialRenewalMode.NONE, null, null, new Date(), null), environment);
    }

    void probe(ConnectorInfo connector, UserMailAccountDTO request, String secret) {
        if ("fastmail-mail".equals(connector.getConnectorCode())) {
            probeFastmail(request.getEmail(), secret);
            return;
        }
        MailServerConfigDTO[] defaults = serverDefaults(request.getProviderCode());
        if (request.getImap() == null) {
            request.setImap(defaults[0]);
        }
        if (request.getSmtp() == null) {
            request.setSmtp(defaults[1]);
        }
        if (request.getImap() == null || request.getSmtp() == null) {
            throw new IllegalArgumentException("邮箱服务器配置不完整");
        }
        try {
            Properties properties = new Properties();
            properties.put("mail.imap.connectiontimeout", "10000");
            properties.put("mail.imap.timeout", "10000");
            properties.put("mail.imap.writetimeout", "10000");
            properties.put("mail.imap.ssl.enable", String.valueOf("ssl".equalsIgnoreCase(request.getImap().getEncryption())));
            properties.put("mail.imap.starttls.enable", String.valueOf("starttls".equalsIgnoreCase(request.getImap().getEncryption())
                || "tls".equalsIgnoreCase(request.getImap().getEncryption())));
            Session session = Session.getInstance(properties);
            try (Store store = session.getStore("imap")) {
                store.connect(request.getImap().getHost(), request.getImap().getPort(), request.getEmail(), secret);
            }
            Properties smtp = new Properties();
            smtp.put("mail.smtp.connectiontimeout", "10000");
            smtp.put("mail.smtp.timeout", "10000");
            smtp.put("mail.smtp.writetimeout", "10000");
            smtp.put("mail.smtp.ssl.enable", String.valueOf("ssl".equalsIgnoreCase(request.getSmtp().getEncryption())));
            smtp.put("mail.smtp.starttls.enable", String.valueOf("starttls".equalsIgnoreCase(request.getSmtp().getEncryption())
                || "tls".equalsIgnoreCase(request.getSmtp().getEncryption())));
            Session smtpSession = Session.getInstance(smtp);
            try (Transport transport = smtpSession.getTransport("smtp")) {
                transport.connect(request.getSmtp().getHost(), request.getSmtp().getPort(), request.getEmail(), secret);
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("邮箱凭据或服务器配置校验失败");
        }
    }

    private void probeFastmail(String email, String token) {
        try {
            java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(10)).build();
            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create("https://api.fastmail.com/jmap/session"))
                .timeout(java.time.Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + token)
                .header("Accept", "application/json")
                .GET().build();
            java.net.http.HttpResponse<String> response = client.send(request,
                java.net.http.HttpResponse.BodyHandlers.ofString(java.nio.charset.StandardCharsets.UTF_8));
            if (response.statusCode() / 100 != 2 || response.body() == null || response.body().isBlank()) {
                throw new IllegalArgumentException("Fastmail 凭据校验失败");
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("Fastmail 凭据校验失败");
        }
    }

    private String providerCodeFor(ConnectorInfo connector) {
        return switch (connector.getConnectorCode()) {
            case "fastmail-mail" -> "fastmail";
            case "qq-mail" -> "qq";
            case "netease-163-mail" -> "netease-163";
            case "aliyun-mail" -> "aliyun-mail";
            case "custom-imap-mail" -> "custom-imap";
            default -> throw new IllegalArgumentException("不支持的邮箱连接器");
        };
    }

    static MailServerConfigDTO[] serverDefaults(String providerCode) {
        var provider = MailProviderCatalog.resolve(providerCode);
        return new MailServerConfigDTO[] { provider.getImap(), provider.getSmtp() };
    }

    private MailServerConfigDTO server(Map<String, String> values, String hostKey, String portKey, String encryptionKey) {
        MailServerConfigDTO server = new MailServerConfigDTO();
        server.setHost(required(values, hostKey));
        server.setPort(Integer.valueOf(required(values, portKey)));
        server.setEncryption(values.getOrDefault(encryptionKey, "ssl"));
        return server;
    }

    private String required(Map<String, String> values, String key) {
        return requiredValue(values.get(key), key);
    }

    private String requiredValue(String value, String key) {
        if (value == null || value.isBlank() || value.length() > 2048) {
            throw new IllegalArgumentException("邮箱凭据字段无效: " + key);
        }
        return value.trim();
    }
}
