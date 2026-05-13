package com.iwhalecloud.byai.manager.entity.sandbox;

import lombok.Data;

import java.util.Map;

/**
 * @author cxf
 * @description: TODO
 * @date 2026/2/27 09:53
 */
@Data
public class LaunchSandboxQo {

    private String userCode;
    private Long resourceId;
    private Map<String, String> env;
}
