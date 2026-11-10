package com.iwhalecloud.byai.state.domain.mobilepush;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tencentyun.TLSSigAPIv2;
import org.springframework.stereotype.Component;

/** 独立 Push 单发适配器，不登录 IM 聊天；HTTP 成功后继续检查业务码和单接收人失败列表。 */
@Component
public class TencentPushClient {
    private static final Set<String> HOSTS = Set.of("console.tim.qq.com", "adminapisgp.im.qcloud.com",
        "adminapikr.im.qcloud.com", "adminapijpn.im.qcloud.com", "adminapiger.im.qcloud.com",
        "adminapiusa.im.qcloud.com", "adminapiidn.im.qcloud.com", "adminapiksa.im.qcloud.com");
    private final MobilePushProperties properties;
    private final ObjectMapper json;
    private final HttpClient http;
    private final SecureRandom random = new SecureRandom();

    @org.springframework.beans.factory.annotation.Autowired
    public TencentPushClient(MobilePushProperties properties, ObjectMapper json) {
        this(properties, json, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build());
    }

    TencentPushClient(MobilePushProperties properties, ObjectMapper json, HttpClient http) {
        this.properties = properties;
        this.json = json;
        this.http = http;
    }

    /** 返回零表示云端受理，仍不等于手机已显示；通知文案不包含工作组名称或聊天正文。 */
    public int send(PushNotification notification, PushDeviceBinding device) {
        if (!properties.ready() || !HOSTS.contains(properties.getHost())) {
            return -2;
        }
        try {
            String userSig = new TLSSigAPIv2(properties.getSdkAppId(), properties.getSecretKey())
                .genUserSig(properties.getAdministrator(), 86400);
            String query = "sdkappid=" + properties.getSdkAppId() + "&identifier="
                + encode(properties.getAdministrator()) + "&usersig=" + encode(userSig)
                + "&random=" + random.nextLong(4294967296L) + "&contenttype=json";
            HttpRequest pushRequest = HttpRequest.newBuilder(URI.create("https://" + properties.getHost()
                    + "/v4/timpush/batch?" + query))
                .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body(notification, device))))
                .build();
            HttpResponse<String> pushResponse = http.send(pushRequest, HttpResponse.BodyHandlers.ofString());
            if (pushResponse.statusCode() != 200) {
                return -1;
            }
            return responseCode(json.readTree(pushResponse.body()));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return -1;
        } catch (IOException | RuntimeException error) {
            // HTTP 异常可能把携带 UserSig 的 URI 写进消息，不能向调用方或日志透传原始异常。
            return -1;
        }
    }

    Map<String, Object> body(PushNotification notification, PushDeviceBinding device) {
        boolean english = device.language().toLowerCase(java.util.Locale.ROOT).startsWith("en");
        Map<String, Object> extension = Map.of("version", 1, "kind", "group-message",
            "environmentId", properties.getEnvironmentId(), "accountId", Long.toString(notification.accountId()),
            "enterpriseId", Long.toString(notification.enterpriseId()), "sessionId", Long.toString(notification.sessionId()),
            "messageId", Long.toString(notification.messageId()));
        Map<String, Object> offline = new LinkedHashMap<>();
        offline.put("PushFlag", 0);
        offline.put("Title", "百应搭伙");
        offline.put("Desc", english ? "New message in your workgroup" : "工作组有新消息");
        try {
            offline.put("Ext", json.writeValueAsString(extension));
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalStateException("Push extension serialization failed");
        }
        offline.put("AndroidInfo", properties.getAndroidInfo());
        offline.put("ApnsInfo", properties.getApnsInfo());
        return Map.of("From_Account", properties.getAdministrator(),
            "To_Account", List.of(device.registrationId()), "Classification", 0,
            "MsgRandom", Long.parseLong(notification.notificationId().substring(0, 8), 16),
            "DataId", notification.notificationId(), "OfflinePushInfo", offline);
    }

    /** 单发也可能 HTTP 200 + ActionStatus OK + ErrorList 非空，必须检查实际接收人的失败结果。 */
    static int responseCode(JsonNode response) {
        if (response == null || !response.path("ErrorCode").isIntegralNumber()
            || !response.path("ErrorCode").canConvertToInt()) {
            return -1;
        }
        int code = response.path("ErrorCode").asInt();
        if (code != 0) {
            return code;
        }
        if (!"OK".equals(response.path("ActionStatus").asText())) {
            return -1;
        }
        JsonNode errors = response.path("ErrorList");
        if (!errors.isMissingNode() && !errors.isNull() && !errors.isArray()) {
            return -1;
        }
        if (errors.isArray() && !errors.isEmpty()) {
            int recipientCode = errors.get(0).path("ErrorCode").asInt(-1);
            return recipientCode == 0 ? -1 : recipientCode;
        }
        return 0;
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
