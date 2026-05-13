package com.iwhalecloud.byai.state.domain.chat.dto;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/16 16:27
 */
@Getter
@Setter
public class ChatDataCloudQo {

    @JSONField(name = "summary")
    private Boolean summary = false;

    @JSONField(name = "internetData")
    private Boolean internetData = false;

    /**
     * 内部知识库
     */
    @JSONField(name = "internalKnowledgeBase")
    private Boolean internalKnowledgeBase = false;

    /**
     * 个人基本信息
     */
    @JSONField(name = "personalBasicInfo")
    private Boolean personalBasicInfo = false;

    /**
     * 鲸家业务数据
     */
    @JSONField(name = "jingjiaBusinessData")
    private Boolean jingjiaBusinessData = false;

    /**
     * 订阅的数字员工
     */
    @JSONField(name = "subscribedDigitalEmployees")
    private Boolean subscribedDigitalEmployees = false;

    /**
     * 浏览器页面数据
     */
    @JSONField(name = "browserPageData")
    private Boolean browserPageData = false;
}
