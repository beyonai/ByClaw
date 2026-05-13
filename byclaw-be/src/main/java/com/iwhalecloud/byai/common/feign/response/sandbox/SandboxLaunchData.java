package com.iwhalecloud.byai.common.feign.response.sandbox;

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
}
