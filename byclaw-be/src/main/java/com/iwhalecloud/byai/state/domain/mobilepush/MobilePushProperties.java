package com.iwhalecloud.byai.state.domain.mobilepush;

import java.util.HashMap;
import java.util.Map;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 手机推送配置；服务端密钥仅留在部署环境，默认关闭以等待免费版和厂商配置完成。 */
@Data
@Component
@ConfigurationProperties(prefix = "byclaw.mobile-push")
public class MobilePushProperties {
    private boolean enabled;
    private long sdkAppId;
    private String clientAppKey = "";
    private String secretKey = "";
    private String administrator = "administrator";
    private String environmentId = "production";
    private String host = "console.tim.qq.com";
    private Map<String, Object> androidInfo = new HashMap<>();
    private Map<String, Object> apnsInfo = new HashMap<>();

    /** 只返回完整配置的启用状态，不把尚未开通的环境伪装为可用。 */
    public boolean ready() {
        return enabled && sdkAppId > 0 && !clientAppKey.isBlank() && !secretKey.isBlank()
            && !administrator.isBlank()
            && ("production".equals(environmentId) || "development".equals(environmentId));
    }
}
