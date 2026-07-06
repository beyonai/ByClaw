package com.iwhalecloud.byai.gateway.channels.service.feishu.model;

import lombok.Getter;
import lombok.Setter;

/**
 * 飞书通讯录用户详情的最小业务字段集合。
 */
@Getter
@Setter
public class FeishuUserDetail {

    private String userId;
    private String openId;
    private String unionId;
    private String name;
    private String mobile;
    private String email;
    private String employeeNo;
}
