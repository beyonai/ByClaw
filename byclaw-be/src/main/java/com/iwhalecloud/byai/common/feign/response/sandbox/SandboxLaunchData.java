package com.iwhalecloud.byai.common.feign.response.sandbox;

import java.util.Date;
import java.util.List;
import java.util.Map;

import lombok.Getter;
import lombok.Setter;

/**
 * 沙箱启动响应数据
 */
@Getter
@Setter
public class SandboxLaunchData {

    /** 沙箱访问端点地址 */
    private String endpoint;

    /** Runtime returned sandbox id. */
    private String sandboxId;

    /** Gateway token bound to the sandbox instance. */
    private String gatewayToken;

    /** All exposed endpoints, one per configured service port. */
    private List<String> endpoints;

    /** Primary service port from sandbox spec. */
    private Integer servicePort;

    /** Headers required by endpoint access, if any. */
    private Map<String, String> endpointHeaders;

    /** Remote automatic expiration timeout in seconds. Null means no remote auto expiration. */
    private Integer timeoutSeconds;

    /** Current remote expiration time. Null means no remote auto expiration. */
    private Date remoteExpiresAt;
}
