package com.iwhalecloud.byai.manager.vo.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-06-25 14:08:45
 * @description TODO
 */
@Getter
@Setter
public class PrivilegeGrantAuditVo {

    private Long grantObjId;

    private String grantToType;

    private Long grantToObjId;

    private String grantToObjType;

    private String statusCd;

    private String pathCode;
}
