package com.iwhalecloud.byai.state.common.share.bean;

import java.util.Date;
import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter

public class Organization {

    private Long orgId;

    /**
     * 组织编码
     */
    private String orgCode;

    /**
     * 组织名称
     */

    private String orgName;

    /**
     * 组织类型(0：内部组织；1：外部组织)
     */
    private String orgType;

    /**
     * 父标识，-1代表顶层
     */

    private Long parentOrgId;

    /**
     * 组织层级(0: 顶级； 1-9往后递增)
     */

    private int orgLevel = 0;

    /**
     * 同层级内排序字段
     */

    private Integer orgIndex = 0;

    /**
     * 创建时间
     */
    private Date createDate;

    /**
     * 更新时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateDate;

    /**
     * 组织路径
     */
    private String pathCode;

    /**
     * 组织描述
     */
    private String orgDesc;

}
