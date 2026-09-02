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

    /**
     * 是否分享：Y / N
     */
    private String isShare;

    private Long createBy;

    /**
     * 默认项目个数。
     * <p>
     * &gt;= 2 时列表查询不再自动带上 project_type = 'default' 条件，仅按成员关系过滤。
     */
    private Long defaultCount = 0L;
}
