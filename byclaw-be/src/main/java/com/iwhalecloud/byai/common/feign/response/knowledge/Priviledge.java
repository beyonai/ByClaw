package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class Priviledge {

    /**
     * 组织权限
     */
    private String org;

    /**
     * 用户权限
     */
    private String user;
}