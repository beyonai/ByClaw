package com.iwhalecloud.byai.common.feign.request.token;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 新增/修改令牌请求体（POST / PUT 均为 /api/token/）。
 * <p>
 * 无 id 时新增，有 id 时修改。
 * </p>
 */
@Getter
@Setter
public class TokenSaveRequest {

    private Integer id;

    private String name;

    @JsonProperty("expired_time")
    private Long expiredTime = -1L;

    @JsonProperty("remain_quota")
    private int remainQuota;

    @JsonProperty("unlimited_quota")
    private boolean unlimitedQuota = true;

    @JsonProperty("model_limits_enabled")
    private boolean modelLimitsEnabled = false;

    @JsonProperty("model_limits")
    private String modelLimits;

    @JsonProperty("allow_ips")
    private String allowIps;

    private String group;

    @JsonProperty("cross_group_retry")
    private boolean crossGroupRetry;
}
