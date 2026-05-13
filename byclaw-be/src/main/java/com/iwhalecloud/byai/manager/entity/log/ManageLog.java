package com.iwhalecloud.byai.manager.entity.log;

import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_manage_log")
public class ManageLog {
    /**
     * 日志主键
     */
    @TableId(value = "log_id", type = IdType.INPUT)
    private Long logId;

    /**
     * 业务名称
     */
    private String moduleName;

    /**
     * 业务操作描述
     */
    private String moduleDescription;

    /**
     * 操作人ID
     */
    private Long operatorUserId;

    /**
     * 操作人姓名
     */
    private String operatorUserName;

    /**
     * 操作来源IP
     */
    private String ipFrom;

    /**
     * 操作参数
     */
    private String operatorParam;

    /**
     * 操作响应结果
     */
    private String operatorResponse;

    /**
     * 操作时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date operatorTime;

    /**
     * 操作类名
     */
    private String className;

    /***
     * 操作方法
     */
    private String method;
}
