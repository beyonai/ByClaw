package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;

class AuthorizationQrCodeEncoderTest {

    private static final String DATA_URI_PREFIX = "data:image/png;base64,";

    private final AuthorizationQrCodeEncoder encoder = new AuthorizationQrCodeEncoder();

    @Test
    void encodesDeviceVerificationUrlAsDecodablePngDataUri() throws IOException {
        String url = "https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=flow-1&user_code=5ZMG-MUFK";

        String dataUri = encoder.encode(url);

        assertThat(dataUri).startsWith(DATA_URI_PREFIX);
        byte[] png = Base64.getDecoder().decode(dataUri.substring(DATA_URI_PREFIX.length()));
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(png));
        assertThat(image).isNotNull();
        assertThat(image.getWidth()).isEqualTo(240);
        assertThat(image.getHeight()).isEqualTo(240);
    }

    @Test
    void encodesUrlsFromEveryConnectorPlatform() {
        // 飞书与钉钉走设备码流程，企微的地址由 CLI 输出扫描得到，域名不固定。
        assertThat(encoder.encode("https://accounts.feishu.cn/oauth/v1/device/verify?user_code=A1B2"))
            .startsWith(DATA_URI_PREFIX);
        assertThat(encoder.encode("https://login.dingtalk.com/oauth2/challenge?user_code=C3D4"))
            .startsWith(DATA_URI_PREFIX);
        assertThat(encoder.encode("https://open.work.weixin.qq.com/wwopen/sso/qr?state=E5F6"))
            .startsWith(DATA_URI_PREFIX);
    }

    @Test
    void returnsNullForMissingBlankOrOversizedUrl() {
        assertThat(encoder.encode(null)).isNull();
        assertThat(encoder.encode("")).isNull();
        assertThat(encoder.encode("   ")).isNull();
        assertThat(encoder.encode("https://example.com/" + "a".repeat(2049))).isNull();
    }

    @Test
    void producesIdenticalOutputForIdenticalUrl() {
        String url = "https://accounts.feishu.cn/oauth/v1/device/verify?user_code=STABLE";

        assertThat(encoder.encode(url)).isEqualTo(encoder.encode(url));
    }
}
