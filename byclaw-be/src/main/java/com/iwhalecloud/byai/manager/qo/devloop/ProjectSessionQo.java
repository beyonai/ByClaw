package com.iwhalecloud.byai.manager.qo.devloop;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 项目会话查询对象
 */
@Getter
@Setter
public class ProjectSessionQo extends QueryObject {

    /** 项目ID */
    private Long projectId;

    /** 创建人 */
    private Long createBy;
}
