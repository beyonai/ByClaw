package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工查询（Open API 免登录）
 * 入参：数字员工类型（001-助手、005-问答、006-问数）、数字员工名称（模糊查询）
 *
 * @author system
 * @date 2026-04-02
 */
@Getter
@Setter
public class OpenApiDigEmployeeQueryQo {

    /**
     * 数字员工类型：001-助手、005-问答、006-问数
     */
    private String agentType;

    /**
     * 数字员工名称（模糊查询）
     */
    private String resourceName;
}
