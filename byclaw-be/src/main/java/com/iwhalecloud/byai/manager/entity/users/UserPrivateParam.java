package com.iwhalecloud.byai.manager.entity.users;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人参数配置。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
@Getter
@Setter
@TableName("po_user_private_param")
public class UserPrivateParam {

    @TableId
    private Long paramId;

    private Long userId;

    private String paramKey;

    private String paramValueCipher;

    private String paramValueLast4;

    private String description;

    private String status;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
