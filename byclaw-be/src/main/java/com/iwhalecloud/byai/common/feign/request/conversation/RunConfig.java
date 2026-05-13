package com.iwhalecloud.byai.common.feign.request.conversation;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-12-22 19:35:06
 * @description TODO
 */
@Getter
@Setter
public class RunConfig {

    /**
     * 使用的大模型编码。
     */
    private String model;

    /**
     * 大模型温度参数。
     */
    private String temperature;

    /**
     * 大模型基础URL。
     */
    private String baseUrl;

    /**
     * 大模型API密钥。
     */
    private String apiKey;
}
