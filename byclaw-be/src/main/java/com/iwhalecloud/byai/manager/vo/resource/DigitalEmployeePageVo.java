package com.iwhalecloud.byai.manager.vo.resource;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2026-04-25 15:28:16
 * @description TODO
 */
@Getter
@Setter
public class DigitalEmployeePageVo {

    /**
     * 资源ID
     */
    private Long resourceId;

    /**
     * 系统编码
     */
    private String systemCode;

    /**
     * 资源来源主键ID
     */
    private Long resourceSourcePkId;

    /**
     * 资源业务类型
     */
    private String resourceBizType;

    /**
     * 资源类型
     */
    private String resourceType;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源归属类型
     */
    private String ownerType;

    /**
     * 目录ID
     */
    private Long catalogId;

    /**
     * 管理组织ID
     */
    private Long manOrgId;

    /**
     * 管理用户ID
     */
    private String manUserId;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 公司账号ID
     */
    private Long comAcctId;

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 发布时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date publishTime;

    /**
     * 开发版本
     */
    private Long resourceDverid;

    /**
     * 生产版本
     */
    private Long resourceRverid;

    /**
     * 上架时间
     */

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date shelfTime;

    /**
     * 下架时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date unshelfTime;

    /**
     * 授权状态
     */
    private String authStatus;

    /**
     * 发布门户
     */
    private String publishPortal;

    /**
     * 创建类型
     */
    private String createType;

    /**
     * 数字员工展示标签。
     */
    private String tagName;

    /**
     * 关联技能标识列表，JSON字符串格式。
     */
    private String skills;

    /**
     * 管理组织名称
     */
    private String manOrgName;

    /**
     * 创建人姓名
     */
    private String createUserName;

    /**
     * 管理用户名称
     */
    private String manUserName;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
