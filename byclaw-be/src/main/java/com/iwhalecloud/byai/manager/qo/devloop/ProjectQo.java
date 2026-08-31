package com.iwhalecloud.byai.manager.qo.devloop;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 项目列表查询对象
 */
@Getter
@Setter
public class ProjectQo extends QueryObject {

    /** 是否分享：Y / N */
    private String isShare;

    private Long createBy;
}
