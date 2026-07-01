package com.iwhalecloud.byai.manager.entity.users;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户Token额度配置。
 */
@Getter
@Setter
@TableName("po_user_token_quota")
public class UserTokenQuota {

    @TableId
    private Long quotaId;

    private Long userId;

    private Long monthlyQuotaLimit;

    private String remark;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
