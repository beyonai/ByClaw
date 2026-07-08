package com.iwhalecloud.byai.common.feign.response.token;

import lombok.Getter;
import lombok.Setter;
import java.util.Map;

/**
 * 批量令牌完整密钥响应 data。
 */
@Getter
@Setter
public class TokenBatchKeysResult {

    private Map<String, String> keys;
}
