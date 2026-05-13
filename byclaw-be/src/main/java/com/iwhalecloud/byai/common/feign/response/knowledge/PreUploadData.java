package com.iwhalecloud.byai.common.feign.response.knowledge;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 20:07:29
 * @description TODO
 */
@Getter
@Setter
public class PreUploadData {

    /**
     * 数据集ID
     */
    @NotNull(message = "{preuploaddata.datasetid.notnull}")
    private Long datasetId;

    /**
     * 元数据信息
     */
    @NotNull(message = "{preuploaddata.metadata.notnull}")
    private String metadata;
}
