package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-12-27 15:35:13
 * @description jwt中的用户信息，只取登陆工号
 */
@Getter
@Setter
public class JwtUserInfo {

    private String userCode;;
}
