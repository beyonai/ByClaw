package com.iwhalecloud.byai.manager.dto.enterprise;

import lombok.Getter;
import lombok.Setter;

/**
 * 企业查询入参。
 */
@Getter
@Setter
public class EnterpriseQueryDTO {

    /**
     * 企业标识，为空时默认查询系统预置企业
     */
    private Long enterpriseId;
}
