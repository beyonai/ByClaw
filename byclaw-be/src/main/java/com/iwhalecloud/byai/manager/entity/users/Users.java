package com.iwhalecloud.byai.manager.entity.users;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("po_users")
public class Users {

    /**
     * 用户标识
     */
    @TableId(value = "user_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{user.userid.notnull}")
    private Long userId;

    /**
     * 用户�?
     */
    @Size(groups = {
        Add.class, Mod.class
    }, min = 2, max = 20, message = "{user.username.size}")
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^[a-zA-Z0-9\\p{IsHan}]+$", message = "{user.username.validate}")
    private String userName;

    /**
     * 邮箱
     */
    @Email(groups = {
        Add.class, Mod.class
    }, message = "{user.email.email}")
    private String email;

    /**
     * 手机号码
     */
    private String phone;

    /**
     * 用户编码
     */
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^[a-zA-Z0-9_]{3,50}$", message = "{user.usercode.pattern}")
    private String userCode;

    /**
     * 用户工号
     */
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^(\\d{0,10})$", message = "{user.usernumber.pattern}")
    private String userNumber;

    /**
     * 密码字段，敏感信息json序列化不返回
     */
    @JsonIgnore
    private String pwd;

    /**
     * 用户地址
     */
    @Size(max = 255, message = "{user.address.size}")
    private String address;

    /***
     * 备注
     */
    @Size(max = 255, message = "{user.address.remark.size}")
    private String remark;

    /**
     * 生效时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date userEffDate;

    /**
     * 过期时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date userExpDate;

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
     * A-正常;X-禁用
     */
    private String state;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date stateTime;

    /**
     * 是否锁定�?Y'-锁定�?N'-没有锁定，null表示'N'
     */
    private String isLocked;

    /**
     * 最后登陆时�?
     */
    private Date lastLoginDate;

    /***
     * 超级助手
     */
    private Long assistantId;

    /**
     * 驻地ID
     */
    private Long stationId;

    /**
     * 注册类型 1为手机号注册
     */
    private Integer registerType;

    /**
     * 苹果用户ID，用于苹果登录关联
     */
    private String appleUserId;

}
