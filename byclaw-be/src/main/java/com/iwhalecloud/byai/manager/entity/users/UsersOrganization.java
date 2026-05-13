package com.iwhalecloud.byai.manager.entity.users;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import com.iwhalecloud.byai.manager.validate.users.annotation.OrgIdValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.PositionIdValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserIdValidator;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_users_organization")
public class UsersOrganization {

    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 用户编码，外键：byai_users表的user_id
     */
    @UserIdValidator
    private Long userId;

    /**
     * 组织编码，外键by_organization的org_id
     */
    @OrgIdValidator
    private Long orgId;

    /**
     * 岗位编码，外�?byai_position表的position_id
     */
    @PositionIdValidator
    private Long positionId;

    /**
     * ORG_MAN:组织管理,BUSINESS_MAN:业务管理,PLAT_MAN:平台管理,ORD_USER:普通用�?PLAT_DEVOPS:平台运维
     */
    @UserIdValidator
    private String userType;

}
