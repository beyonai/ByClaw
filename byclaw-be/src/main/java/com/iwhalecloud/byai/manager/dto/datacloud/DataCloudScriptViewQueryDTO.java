package com.iwhalecloud.byai.manager.dto.datacloud;

import lombok.Data;

import java.util.List;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/11 17:35
 */
@Data
public class DataCloudScriptViewQueryDTO {
    /**
     * 视图ID列表
     */
    private List<Long> viewIdList;

    /**
     * 发布视图关联的插件引擎项目空间ID
     */
    private Long resourceProjectId;

    /**
     * 分页参数 - 页码
     */
    private Integer pageNum = 1;

    /**
     * 分页参数 - 每页大小
     */
    private Integer pageSize = 10;

    private String keyword;

    private Long viewId;
}
