package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-29 14:44:28
 * @description TODO
 */

@Getter
@Setter
public class WhaleTokenUser {

    private Long id;

    /**
     * 工号:0027012991
     */
    private String userCode;

    /**
     * 用户名
     */
    private String name;

    /**
     * 公司名称:浩鲸云计算科技股份有限公司
     */
    private String belong;

    /**
     * 公司邮箱:he.duming@iwhalecloud.com
     */
    private String mail;

    /**
     * 所在组织名称:数据工厂研发团队
     */
    private String org;

    /**
     * 职位:Java开发工程师
     */
    private String job;

    /***
     * 部门:数据智能事业部
     */
    private String dept;

    private String iss;

    /**
     * 位置:广州
     */
    private String station;

    /**
     * 头像地址
     */
    private String userImg;

    /***
     * 刷新token地址
     */
    private String refreshToken;

    private Object exp;

    private Object iat;

    private Object counter;

    private String phone;

    private Object orgId;

    private Object jobId;

    private Object deptId;
}
