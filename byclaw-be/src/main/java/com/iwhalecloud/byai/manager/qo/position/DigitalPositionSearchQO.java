package com.iwhalecloud.byai.manager.qo.position;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字岗位查询对象
 */
@Getter
@Setter
public class DigitalPositionSearchQO extends QueryObject {

    /**
     * 领域ID（可选）
     */
    private Long catalogId;

    /**
     * 岗位名称（可选，模糊查询）
     */
    private String positionName;
}
