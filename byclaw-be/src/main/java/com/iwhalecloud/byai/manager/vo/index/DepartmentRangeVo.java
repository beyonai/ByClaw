package com.iwhalecloud.byai.manager.vo.index;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-14 22:33:27
 * @description TODO
 */
@Getter
@Setter
public class DepartmentRangeVo {

    private Long orgId;

    private String orgName;

    private Long parentOrgId;

    private int orgLevel = 0;

    private String pathCode;
}
