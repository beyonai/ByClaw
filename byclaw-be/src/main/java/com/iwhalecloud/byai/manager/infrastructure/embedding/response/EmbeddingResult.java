package com.iwhalecloud.byai.manager.infrastructure.embedding.response;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-02 00:00:24
 * @description TODO
 */
@Getter
@Setter
public class EmbeddingResult {

    /**
     * 类型
     */
    private String object;

    /**
     * 返回值
     */
    private List<Data> data;

    /**
     * 模型名称
     */
    private String model;

}
