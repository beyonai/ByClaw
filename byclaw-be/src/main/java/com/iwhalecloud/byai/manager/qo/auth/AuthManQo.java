package com.iwhalecloud.byai.manager.qo.auth;


import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-10 17:49:41
 * @description TODO
 */
@Getter
@Setter
public class AuthManQo {

    private String grantType;

    private Long grantToObjId;

    private String grantObjType;
}
