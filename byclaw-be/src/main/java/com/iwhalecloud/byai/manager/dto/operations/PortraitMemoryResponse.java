package com.iwhalecloud.byai.manager.dto.operations;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * 场景记忆响应DTO
 * 
 * @author system
 * &#064;date  2025-01-XX
 */
@Data
@Schema(description = "场景响应")
public class PortraitMemoryResponse implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 最后更新时间
     */
    @Schema(description = "最后更新时间")
    private Date lastUpdateTime;

    /**
     * 工作描述和偏好列表
     */
    @Schema(description = "工作描述和偏好")
    private List<String> workDescription;

    /**
     * 计数列表（当memSceneId=101，返回按cnt降序排序后的cnt数组）
     */
    @Schema(description = "计数列表（当memSceneId=101返回）")
    private List<Integer> cntList;

}

