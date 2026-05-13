package com.iwhalecloud.byai.manager.entity.token;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-06-05 17:15:01
 * @description 用户令牌管理
 */
@Getter
@Setter
@TableName("po_user_access_token")
public class UserAccessToken {

    /**
     * 主键
     */
    @TableId(value = "user_access_token_id", type = IdType.INPUT)
    private Long userAccessTokenId;

    /**
     * 用户唯一标识
     */
    private Long userId;

    /**
     * 令牌名称
     */
    private String accessTokenName;

    /**
     * 服务器生成的token值
     */
    private String accessToken;

    /**
     * 状态00A有效0X无效
     */
    private String tokenStatus;

    /**
     * 有效开始时间
     */
    private Date startTime;

    /**
     * 有效截止时间
     */
    private Date endTime;

    /**
     * 创建人
     */
    private Long createUser;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 所属企业
     */
    private Long comAcctId;

    /**
     * 最后使用时间
     */
    private Date lastActiveTime;

}