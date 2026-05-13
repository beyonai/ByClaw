package com.iwhalecloud.byai.manager.entity.organization;

import java.util.Date;

import com.iwhalecloud.byai.manager.validate.organization.annotation.AddOrgValidator;
import com.iwhalecloud.byai.manager.validate.organization.annotation.ParentOrgIdValidator;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_organization")
@AddOrgValidator(groups = {
    Add.class, Mod.class
})
public class Organization {

    @TableId(value = "org_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{organization.orgid.notnull}")
    private Long orgId;

    /**
     * 组织编码
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{organization.orgcode.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 200, message = "{organization.orgcode.size}")
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^[a-zA-Z0-9_]+$", message = "{organization.orgcode.pattern}")
    private String orgCode;

    /**
     * 组织名称
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{organization.orgname.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "{organization.orgname.size}")
    private String orgName;

    /**
     * 组织类型(0：内部组织；1：外部组织
     */
    private String orgType;

    /**
     * 父标识，-1代表顶层
     */
    @ParentOrgIdValidator(groups = Add.class, message = "{organization.parentorgid.valid}")
    @NotNull(groups = Add.class, message = "{organization.parentorgid.notnull}")
    private Long parentOrgId;

    /**
     * 组织层级(0: 顶级�?1-9往后递增)
     */
    @Min(value = 0, message = "{organization.orglevel.min}")
    @Max(value = Integer.MAX_VALUE, message = "{organization.orglevel.max}")
    private int orgLevel = 0;

    /**
     * 同层级内排序字段
     */
    @Min(groups = {
        Add.class, Mod.class
    }, value = 0, message = "{organization.sort.min}")
    @Max(groups = {
        Add.class, Mod.class
    }, value = Integer.MAX_VALUE, message = "{organization.sort.max}")
    private Integer orgIndex = 0;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
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
    @Size(groups = {
        Add.class, Mod.class
    }, max = 500, message = "{organization.orgdesc.size}")
    private String orgDesc;

}
