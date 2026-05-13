package com.iwhalecloud.byai.manager.vo.index;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-13 14:17:48
 * @description TODO
 */
@Getter
@Setter
public class ManPrivVo {

    /**
     * 授权资源标识
     */
    private Long grantObjId;

    /**
     * 所有授权管理者用户标识
     */
    private Long manPrivId;

    /**
     * 所有授权管理者权限的名称
     */
    private String manPrivName;
}
