package com.iwhalecloud.byai.state.domain.session.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * 按用户编码查询工作空间 skill 列表请求。
 *
 * @author qin.guoquan
 * @date 2026-04-28 18:45:00
 */
@Getter
@Setter
public class QrySkillListByUserCodeQo {

    /**
     * 用户编码；为空时回退到当前登录用户。
     */
    private String userCode;

    /**
     * 数字员工资源ID，用于拼接工作空间路径。
     */
    private Long resourceId;

    /**
     * skill 目录关键字，按一层 skillFileName 目录名模糊匹配。
     */
    private String keyword;
}
