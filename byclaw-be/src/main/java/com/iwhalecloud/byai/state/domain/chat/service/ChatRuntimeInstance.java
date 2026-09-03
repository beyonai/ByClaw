package com.iwhalecloud.byai.state.domain.chat.service;

import java.net.InetAddress;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

@Component
public class ChatRuntimeInstance {

    private static final String DEVELOPMENT_ENV = "development";

    private final boolean development;

    private final String instanceId;

    public ChatRuntimeInstance() {
        this(System.getenv("BE_ENV"), System.getenv("BE_DOMAINNAME"), resolveHostName());
    }

    ChatRuntimeInstance(String environment, String domainName, String hostName) {
        this.development = DEVELOPMENT_ENV.equals(environment);
        this.instanceId = buildInstanceId(domainName, hostName);
    }

    public String getInstanceId() {
        return instanceId;
    }

    public boolean isDevelopment() {
        return development;
    }

    private String buildInstanceId(String domainName, String hostName) {
        if (development) {
            if (StringUtils.isBlank(hostName)) {
                throw new IllegalStateException("BE_ENV=development 时无法获取本机 hostname，不能生成稳定的聊天实例标识");
            }
            if (StringUtils.isBlank(domainName)) {
                throw new IllegalStateException("BE_ENV=development 时必须配置 BE_DOMAINNAME，不能生成稳定的聊天实例标识");
            }
            return DEVELOPMENT_ENV + ":" + hostName + ":" + domainName;
        }
        return StringUtils.defaultIfBlank(hostName, "unknown") + ":" + UUID.randomUUID();
    }

    private static String resolveHostName() {
        try {
            return InetAddress.getLocalHost().getHostName();
        }
        catch (Exception e) {
            return null;
        }
    }
}
