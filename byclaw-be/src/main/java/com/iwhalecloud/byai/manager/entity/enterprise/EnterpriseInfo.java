package com.iwhalecloud.byai.manager.entity.enterprise;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

/**
 * 企业信息领域模型
 */
@Getter
@Setter
@TableName("po_enterprise_info")
public class EnterpriseInfo {

    /**
     * 唯一 ID
     */
    @TableId(value = "enterprise_id", type = IdType.INPUT)
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
     * 企业级系统名称
     */
    private String systemName;

    /**
     * 企业地址
     */
    private String comAcctAddress;

    /**
     * 企业 Logo 图片，存储为二进制数据
     */
    private byte[] logoData;

    /**
     * 企业版本信息
     */
    private String copyright;

    /**
     * 是否可切换到 demo 数据源 否，1 是
     */
    private String demoSwitch;

    /**
     * 是否开启多项目切换: 0 否，1 是
     */
    private String projectSwitch;

}
