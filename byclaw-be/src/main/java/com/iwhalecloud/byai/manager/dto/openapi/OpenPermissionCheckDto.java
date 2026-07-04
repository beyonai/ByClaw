package com.iwhalecloud.byai.manager.dto.openapi;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 开放接口权限批量校验入参。
 *
 * @author qin.guoquan
 * @date 2026-07-04 22:00:38
 */
@Getter
@Setter
public class OpenPermissionCheckDto {

    /**
     * 数字员工资源ID列表。
     */
    private List<Long> agentIds;

    /**
     * 资源ID列表。
     */
    private List<Long> resourceIds;

    /**
     * 资源编码列表。
     */
    private List<String> resourceCodes;
}
