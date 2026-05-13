package com.iwhalecloud.byai.manager.entity.log;

import java.io.Serializable;
import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 异常日志实体类，对应表：log_exception_info
 */
@Getter
@Setter
@TableName("log_exception_info")
public class LogExceptionInfo implements Serializable {
    /**
     * 主键ID
     */
    @TableId(value = "request_id", type = IdType.INPUT)
    private Long requestId;

    /**
     * 系统编码,BYAI_BE:会话,BYAI_BE_MANAGER:后台管理
     */
    private String sysCode;

    /**
     * 异常编码:BYAI_BE:1xxxx,BAYI_BE_MANAGER:2xxxx
     */
    private String errorCode;

    /**
     * 错误模块编码:APP_BY:会话后端,APP_MANAGER:管理后端,APP_BY_FE:会话前端,APP_MANAGER_FE:管理前端,APP_AGENT:智能体平台,APP_AIWRITE:智慧写作,APP_CHATBI:chatBi,APP_DOCCHAIN:docChain,APP_DH:鲸灵
     */
    private String errorModule;

    /**
     * 异常信息
     */
    private String errorMsg;

    /**
     * 异常堆栈信息
     */
    private String errorStack;

    /**
     * 异常类名
     */
    private String className;

    /**
     * 异常方法名
     */
    private String methodName;

    /**
     * 线程名称
     */
    private String threadName;

    /**
     * 服务器IP
     */
    private String hostIp;

    /**
     * 请求URL
     */
    private String requestUrl;

    /**
     * 请求头
     */
    private String requestHeader;

    /**
     * 请求体
     */
    private String requestBody;

    /**
     * 操作用户ID
     */
    private Long userId;

    /**
     * 操作用户名称
     */
    private String userName;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 会话Id
     */
    private String sessionId;
}
