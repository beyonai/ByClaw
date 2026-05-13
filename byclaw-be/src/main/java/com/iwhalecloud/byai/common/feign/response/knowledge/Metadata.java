package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 20:07:52
 * @description TODO
 */
@Getter
@Setter
public class Metadata {

    /***
     * 文档库标识
     */
    private Long datasetId;

    /**
     * 目录标识,默认为-1
     */
    private Long fileCollectId = -1L;

    /**
     * 类型,默认为 4混合类型
     */
    private String datasetType = "4";
}
