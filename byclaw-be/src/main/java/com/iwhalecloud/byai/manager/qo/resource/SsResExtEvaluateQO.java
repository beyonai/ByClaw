package com.iwhalecloud.byai.manager.qo.resource;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工评估结果查询对象
 */
@Getter
@Setter
public class SsResExtEvaluateQO extends QueryObject {

    /**
     * 数字员工资源ID
     */
    private Long resourceId;

}
