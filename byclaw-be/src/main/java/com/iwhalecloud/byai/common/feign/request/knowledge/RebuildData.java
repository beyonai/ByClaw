package com.iwhalecloud.byai.common.feign.request.knowledge;

import java.util.List;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 20:13:35
 * @description TODO
 */

@Getter
@Setter
public class RebuildData {

    /***
     * 知识训
     */
    @NotNull(message = "{rebuilddata.kb.notnull}")
    private Long datasetId;

    /**
     * 构建的文件列表
     */
    @NotEmpty(message = "{rebuilddata.fileids.notempty}")
    private List<Long> files;

    /**
     * 文档类型
     */
    private String datasetType = "4";
}
