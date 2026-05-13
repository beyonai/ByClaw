package com.iwhalecloud.byai.gateway.sandbox.controller.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.Map;

@Data
public class SandboxLaunchRequest {

    @JsonProperty("sandbox_type")
    private String sandboxType;

    @JsonProperty("user_code")
    private String userCode;

    @JsonProperty("auto_release")
    private Integer autoRelease;

    @JsonProperty("envs")
    private Map<String, String> envs;

    @JsonProperty("user_info")
    private Map<String, Object> userInfo;
}
