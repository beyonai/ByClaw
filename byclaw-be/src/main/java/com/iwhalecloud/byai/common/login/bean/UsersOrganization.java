package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

@Getter
@Setter
public class UsersOrganization implements Serializable {

    private Long orgId;

    private String orgName;

    private Long positionId;

    private String positionName;

    private String userType;

    private String pathCode;

    private String pathName;

}
