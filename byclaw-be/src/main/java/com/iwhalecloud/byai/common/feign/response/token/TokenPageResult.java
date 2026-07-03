package com.iwhalecloud.byai.common.feign.response.token;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * Token API 分页列表响应 data。
 */
@Getter
@Setter
public class TokenPageResult {

    private Integer page;

    @JsonProperty("page_size")
    private Integer pageSize;

    private Integer total;

    private List<TokenDto> items;
}
