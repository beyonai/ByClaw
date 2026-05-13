package com.iwhalecloud.byai.common.login.bean;


import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * @author he.duming
 * @date 2025-05-10 18:08:55
 * @description TODO
 */

@Getter
@Setter
public class UserManageOrg implements Serializable {

    private Long userId;

    private Long orgId;

    private String orgName;
}
