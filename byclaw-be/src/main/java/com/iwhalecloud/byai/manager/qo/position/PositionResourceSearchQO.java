package com.iwhalecloud.byai.manager.qo.position;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 岗位数字员工查询对象
 */
@Getter
@Setter
public class PositionResourceSearchQO extends QueryObject {

    /**
     * 岗位ID
     */
    private Long positionId;

    /**
     * 数字员工名称（可选，模糊查询）
     */
    private String resourceName;
}
