package com.iwhalecloud.byai.common.feign.request.token;

import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * 批量操作令牌 ID 列表请求体。
 */
@Getter
@Setter
public class TokenBatchIdsRequest {

    private List<Integer> ids;
}
