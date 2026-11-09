package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class TencentPushClientTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void httpSuccessStillChecksBusinessCodeAndPerRecipientErrors() throws Exception {
        assertThat(TencentPushClient.responseCode(json.readTree("""
            {"ActionStatus":"OK","ErrorCode":0,"ErrorList":[{"To_Account":"device","ErrorCode":70107}]}
            """))).isEqualTo(70107);
        assertThat(TencentPushClient.responseCode(json.readTree("""
            {"ActionStatus":"FAIL","ErrorCode":90045}
            """))).isEqualTo(90045);
        assertThat(TencentPushClient.responseCode(json.readTree("""
            {"ActionStatus":"OK","ErrorCode":0,"ErrorList":[]}
            """))).isZero();
        for (String invalid : new String[] {"{}", "{\"ErrorCode\":0.5}",
            "{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"ErrorList\":{}}"}) {
            assertThat(TencentPushClient.responseCode(json.readTree(invalid))).isEqualTo(-1);
        }
    }

    @Test
    void bodyOnlyContainsControlledTextAndStringBusinessIds() throws Exception {
        MobilePushProperties properties = new MobilePushProperties();
        TencentPushClient client = new TencentPushClient(properties, json);
        PushNotification notification = new PushNotification("a".repeat(64), 1, 9007199254740993L,
            9007199254740994L, 22, "installation-test-device", 1);
        PushDeviceBinding device = new PushDeviceBinding("installation-test-device", 1, "registration", "ios", "en");
        var body = json.valueToTree(client.body(notification, device));
        assertThat(body.path("To_Account").get(0).asText()).isEqualTo("registration");
        assertThat(body.path("OfflinePushInfo").path("Desc").asText()).isEqualTo("New message in your workgroup");
        var target = json.readTree(body.path("OfflinePushInfo").path("Ext").asText());
        assertThat(target.path("sessionId").asText()).isEqualTo("9007199254740993");
        assertThat(target.path("accountId").asText()).isEqualTo("22");
        assertThat(body.toString()).doesNotContain("secretKey", "token", "userSig", "messageContent");
    }
}
