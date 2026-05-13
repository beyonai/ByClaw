package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 权限组授权用户视图对象
 * 用于返回权限组下授权的用户信息（去重）
 */
@Getter
@Setter
public class AuthorizedUserVO {

    /**
     * 用户ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long userId;

    /**
     * 用户编码
     */
    private String userCode;

    /**
     * 用户名称
     */
    private String userName;

    /**
     * 用户邮箱
     */
    private String userEmail;

    /**
     * 用户手机号
     */
    private String userPhone;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 是否存在扩展数据权限
     * true: 该用户已设置单独的数据权限配置
     * false: 该用户使用权限组默认数据权限
     */
    private Boolean hasExtPer;

}
