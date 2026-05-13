package com.iwhalecloud.byai.manager.vo.digitemploy;

import lombok.Getter;
import lombok.Setter;

/**
 * 设置默认数字员工返回结果
 */
@Getter
@Setter
public class SetDefaultDigitalEmployeeResultVo {

    /**
     * 新的默认数字员工资源ID
     */
    private Long newResourceId;

    /**
     * 新的默认数字员工最新标签名称
     */
    private String newPersonalDefaultTagName;

    /**
     * 新的默认数字员工最新归属类型
     */
    private String newOwnerType;

    /**
     * 旧的默认数字员工资源ID
     */
    private Long oldResourceId;

    /**
     * 旧的默认数字员工最新标签名称
     */
    private String oldPersonalDefaultTagName;

    /**
     * 旧的默认数字员工最新归属类型
     */
    private String oldOwnerType;
}
