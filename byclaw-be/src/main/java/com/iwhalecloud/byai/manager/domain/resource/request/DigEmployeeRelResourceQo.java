package com.iwhalecloud.byai.manager.domain.resource.request;

import com.iwhalecloud.byai.common.qo.QueryObject;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 数字员工关联资源查询请求。
 *
 *  * @author qin.guoquan
 *  * @date 2026-04-22 01:00:18
 */
@Data
@ApiModel(description = "数字员工关联资源查询请求")
public class DigEmployeeRelResourceQo extends QueryObject implements Serializable {

    /**
     * 数字员工资源ID。
     */
    @ApiModelProperty(value = "数字员工资源ID", required = true)
    private Long resourceId;

    /**
     * 目录ID。
     */
    @ApiModelProperty(value = "目录ID", required = false)
    private Long catalogId;

    /**
     * 后端按 catalogId 展开后的当前目录及子目录 ID。
     */
    private List<Long> catalogIds;
}
