package com.iwhalecloud.byai.manager.qo.index;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-11 09:18:45
 * @description TODO
 */

@Getter
@Setter
public class OrgFilterQo {

    /**
     * ALL：全部（包含全部场景）；COMPANY：公司范围（全公司员工可访问）；DEPT：部门范围（当前用户所属及相关部门可访问）；CUSTOM：自定义范围（支持用户自主选择特定组织/人员范围）
     */
    private String type;

    private Long objectId;
}
