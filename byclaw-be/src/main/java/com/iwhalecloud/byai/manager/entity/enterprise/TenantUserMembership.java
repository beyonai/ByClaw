package com.iwhalecloud.byai.manager.entity.enterprise;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 用户与企业租户的成员关系，对应表 tenant_user_membership。
 */
@Getter
@Setter
@TableName("tenant_user_membership")
public class TenantUserMembership {

    /**
     * 成员关系主键 ID
     */
    @TableId(value = "membership_id", type = IdType.INPUT)
    private Long membershipId;

    /**
     * 所属企业租户 ID
     */
    private Long enterpriseId;

    /**
     * 平台用户 ID
     */
    private Long userId;

    /**
     * 租户角色：OWNER / ADMIN / MEMBER
     */
    private String role;

    /**
     * 成员状态：ACTIVE / DISABLED
     */
    private String status;

    /**
     * 添加该租户成员的操作人 ID
     */
    private Long createdBy;

    /**
     * 加入租户时间
     */
    private Date joinedAt;

    /**
     * 成员关系最近更新时间
     */
    private Date updatedAt;
}
