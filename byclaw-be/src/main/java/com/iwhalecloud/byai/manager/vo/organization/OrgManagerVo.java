package com.iwhalecloud.byai.manager.vo.organization;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-26 20:38:08
 * @description 组织管理员
 */
@Getter
@Setter
public class OrgManagerVo {

    private Long userId;

    private String userCode;

    private String userName;

    private Long orgId;

}
