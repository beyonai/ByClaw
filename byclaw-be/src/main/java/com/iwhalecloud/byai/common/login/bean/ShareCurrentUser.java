package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-14 14:12:23
 * @description 共享session中的对象
 */

@Getter
@Setter
public class ShareCurrentUser {

    private Long userId;

    private String userCode;

    private String userName;

    private String roleId;

    private String roleCode;

    private String roleName;

    private String email;

    private String userType;

}
