package com.iwhalecloud.byai.manager.entity.organization;

import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_org_external_system")
public class OrgExternalSystem {

    /**
     * 组织外部系统ID
     */
    @TableId(value = "po_org_external_system_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{orgexternalsystem.id.notnull}")
    private Long poOrgExternalSystemId;

    /**
     * 统一标识
     */
    private String unionId;

    /**
     * 来源类型
     */
    private Integer sourceType;

    /**
     * 来源部门ID
     */
    @NotNull(groups = {
        Add.class, Mod.class
    }, message = "{orgexternalsystem.deptid.notnull}")
    private Long sourceDepId;

    /**
     * 来源部门编码
     */
    @NotNull(groups = {
        Add.class, Mod.class
    }, message = "{orgexternalsystem.deptcode.notnull}")
    @Size(max = 255, message = "{orgexternalsystem.deptcode.size}")
    private String sourceDepCode;

    /**
     * 来源部门名称
     */
    @NotNull(groups = {
        Add.class, Mod.class
    }, message = "{orgexternalsystem.deptname.notnull}")
    @Size(max = 255, message = "{orgexternalsystem.deptname.size}")
    private String sourceDepName;

    /**
     * 来源父组织
     */
    private Long sourceParentDepId;

    /**
     * 绑定时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date bindingTime;

    private Long orgId;
}