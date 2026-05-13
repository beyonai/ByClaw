package com.iwhalecloud.byai.manager.dto.auth;


import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-10 17:33:53
 * @description TODO
 */
@Getter
@Setter
public class ManOrgDTO {

    private Long grantObjId;

    private String grantObjType;

    private String grantObjName;
}
