package com.iwhalecloud.byai.common.feign.request.knowledge;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 20:07:52
 * @description TODO
 */
@Getter
@Setter
@Schema(description = "元数据实体")
public class Metadata {

    /***
     * 文档库标识
     */
    @Schema(description = "文档库标识")
    private Long datasetId;

    /**
     * 目录标识
     */
    @Schema(description = "目录标识")
    private Long fileCollectId;

    /**
     * 类型
     */
    @Schema(description = "数据集类型")
    private String datasetType;
}
