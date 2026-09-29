package com.iwhalecloud.byai.manager.vo.enterprise;

import lombok.Getter;
import lombok.Setter;

/**
 * 用户关联企业简要信息。
 */
@Getter
@Setter
public class UserEnterpriseVo {

    /**
     * 企业标识
     */
    private Long enterpriseId;

    /**
     * 企业名称
     */
    private String comAcctName;

    /**
     * 企业编码
     */
    private String comAcctCode;

    /**
     * 用户在企业中的角色编码
     */
    private String role;

    /**
     * 用户在企业中的成员状态
     */
    private String status;
}
