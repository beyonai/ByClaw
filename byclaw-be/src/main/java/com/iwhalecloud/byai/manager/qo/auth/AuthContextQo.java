package com.iwhalecloud.byai.manager.qo.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-02-04 00:08:50
 * @description TODO
 */
@Getter
@Setter
public class AuthContextQo extends AuthQo {

    private String resourceBizType;
}
