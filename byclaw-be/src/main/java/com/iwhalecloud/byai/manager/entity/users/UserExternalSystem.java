package com.iwhalecloud.byai.manager.entity.users;

import java.util.Date;

import com.iwhalecloud.byai.manager.validate.users.annotation.SourceTypeValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserIdValidator;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
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
@TableName("po_user_external_system")
public class UserExternalSystem {
    /**
     * 唯一标识
     */
    @TableId(value = "id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{userexternalsystem.id.notnull}")
    private Long id;

    /**
     * 用户标识
     */
    @UserIdValidator(groups = {
            Add.class, Mod.class
    }, message = "{userexternalsystem.userinfo.notnull}")
    private Long userId;

    /**
     * 来源类型:0-本系统用户；1-钉钉�?-企业微信
     */
    @SourceTypeValidator(groups = {
            Add.class, Mod.class
    }, message = "{userexternalsystem.type.notnull}")
    private int sourceType;

    /**
     * 外部系统账号
     */
    @Size(groups = {
            Add.class, Mod.class
    }, max = 255, message = "{userexternalsystem.account.size}")
    private String sourceAccount;

    /**
     * 外部系统昵称
     */
    @Size(groups = {
            Add.class, Mod.class
    }, max = 255, message = "{userexternalsystem.nickname.size}")
    private String sourceNickname;

    /**
     * 外部系统邮箱
     */
    @Email(groups = {
            Add.class, Mod.class
    }, message = "{userexternalsystem.email.email}")
    private String sourceEmail;

    /**
     * 外部系统部门编码
     */
    private String sourceDepId;

    /**
     * 外部系统部门名称
     */
    @Size(groups = {
            Add.class, Mod.class
    }, max = 255, message = "{userexternalsystem.deptname.size=}")
    private String sourceDepName;

    /**
     * 绑定时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date bindingTime;

    /**
     * 跨应用唯一标识
     */
    private String unionId;
}
