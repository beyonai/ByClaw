package com.iwhalecloud.byai.manager.entity.customer;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.Date;

/**
 * 客户留资实体
 * 对应表：byai_customer_leads
 * 用于记录云栖大会及阿里云环境的客户留资信息
 */
@Getter
@Setter
@TableName("byai_customer_leads")
public class ByaiCustomerLeads implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 主键ID
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 企业名称
     */
    private String companyName;

    /**
     * 联系人姓名
     */
    private String contactName;

    /**
     * 行业领域
     */
    private String industry;

    /**
     * 手机号码
     */
    private String phone;

    /**
     * 微信号
     */
    private String wechat;

    /**
     * 客户诉求/需求描述
     */
    private String demand;

    /**
     * 创建时间
     */
    private Date createTime;
} 