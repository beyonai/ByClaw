package com.iwhalecloud.byai.common.feign.response.token;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * Token API 令牌数据模型。
 */
@Getter
@Setter
public class TokenDto {

    private Integer id;

    @JsonProperty("user_id")
    private Integer userId;

    private String key;

    private Integer status;

    private String name;

    @JsonProperty("created_time")
    private Long createdTime;

    @JsonProperty("accessed_time")
    private Long accessedTime;

    @JsonProperty("expired_time")
    private Long expiredTime;

    @JsonProperty("remain_quota")
    private Integer remainQuota;

    @JsonProperty("unlimited_quota")
    private Boolean unlimitedQuota;

    @JsonProperty("model_limits_enabled")
    private Boolean modelLimitsEnabled;

    @JsonProperty("model_limits")
    private String modelLimits;

    @JsonProperty("allow_ips")
    private String allowIps;

    @JsonProperty("used_quota")
    private Integer usedQuota;

    private String group;

    @JsonProperty("cross_group_retry")
    private Boolean crossGroupRetry;
}
