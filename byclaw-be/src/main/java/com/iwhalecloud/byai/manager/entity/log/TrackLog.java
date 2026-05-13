package com.iwhalecloud.byai.manager.entity.log;

import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 日志埋点实体类，对应表：byai_track_log 用于记录前端埋点日志信息
 *
 * @author system
 * @date 2025-01-20
 */
@Getter
@Setter
@TableName("byai_track_log")
public class TrackLog {

    /**
     * 追踪ID（主键）
     */
    @TableId(value = "trace_id", type = IdType.INPUT)
    private Long traceId;

    /**
     * 用户ID
     */
    private Long userId;

    /**
     * 事件编码
     */
    private String eventCode;

    /**
     * 事件名称
     */
    private String eventName;

    /**
     * 事件类型,VIEW: 页面浏览，CLICK: 点击，INPUT: 输入，SUBMIT: 提交，EXPOSE: 曝光，CLOSE: 关闭
     */
    private String eventType;

    /**
     * 元素ID
     */
    private String elementId;

    /**
     * 元素编码
     */
    private String elementCode;

    /**
     * 元素名称
     */
    private String elementName;

    /**
     * 点击资源对象标识
     */
    private Long objectId;

    /**
     * 点击资源对象类型,DIG_EMPLOYEE: 数字员工，AGENT: 智能体，MCP:MCP 服务，TOOL: 工具，MCP_TOOL:MCP 工具，TOOLKIT: 插件，KG_DOC: 文档知识库，KG_DB:
     * 数据知识库，KG_TERM: 术语知识库，KG_QA: 问答知识库，VIEW: 视图，OBJECT: 对象，ACTION: 动作
     */
    private String objectType;

    /**
     * 页面路径
     */
    private String pagePath;

    /**
     * 页面标题
     */
    private String pageTitle;

    /**
     * 浏览器信息
     */
    private String browserInfo;

    /**
     * IP地址
     */
    private String ip;

    /**
     * 设备ID
     */
    private String deviceId;

    /**
     * 设备型号
     */
    private String deviceModel;

    /**
     * 操作系统类型
     */
    private String osType;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 扩展参数（JSON格式）
     */
    private String extParams;
}
