package com.iwhalecloud.byai.manager.vo.index;

import lombok.Getter;
import lombok.Setter;

/**
 * 会话资源信息视图对象。
 * 根据sessionIds查询关联的资源信息。
 */
@Getter
@Setter
public class SessionMemberResourceVo {

    /**
     * 资源ID
     */
    private Long resourceId;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 头像地址
     */
    private String avatar;

    /**
     * 智能体类型
     */
    private String agentType;

    /**
     * 首页地址
     */
    private String agentHomeUrl;

    /**
     * 终端类型
     */
    private String terminal;

    /**
     * 标签名称
     */
    private String tagName;

    /**
     * 会话ID
     */
    private Long sessionId;
}