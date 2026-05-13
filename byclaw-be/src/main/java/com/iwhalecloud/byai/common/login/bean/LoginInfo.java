package com.iwhalecloud.byai.common.login.bean;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Getter
@Setter
public class LoginInfo implements Serializable {

    /*
     * 外部接入参数
     */
    private Map<String, String> paramMap = new HashMap<String, String>();

    private Long userId;

    private String userCode;

    private String userName;

    private String email;

    private String phone;

    private String memo;

    /**
     * 超级助手
     */
    private Long assistantId;

    /***
     * 企业标识
     */
    private Long enterpriseId;

    /***
     * 适配旧门户的企业标识
     */
    private Long comAcctId;

    /**
     * 会话标识
     */
    private String sessionId;

    /**
     * 过期时间
     */
    private Long expiredTime;

    /**
     * 用户关联组织
     */
    private List<UsersOrganization> usersOrganizations;

    /**
     * 用户管理组织
     */
    private List<UserManageOrg> userManageOrgs;

    /**
     * 助理关联唯一个知识库id，用于存储上传的文档
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionDatasetId;

    /**
     * 默认个人助理数字员工ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long defaultDigEmployeeId;

    /**
     * 登陆拦截器处理类型
     */
    private String filterType;

    /**
     * 用户驻地标识
     */
    private UserStation userStation;

    /**
     * 用户登陆类型
     */
    private String loginType;

    /**
     * 是否留资
     */
    private Boolean isRetented;

    /**
     * 注册类型
     */
    private Integer registerType;

    /**
     * 是否默认密码
     */
    private Boolean isDefaultPwd = false;

}
