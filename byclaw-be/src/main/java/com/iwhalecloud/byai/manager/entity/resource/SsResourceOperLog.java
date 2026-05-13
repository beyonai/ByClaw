package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 资源操作日志表实体类
 */
@Data
@TableName("ss_resource_oper_log")
public class SsResourceOperLog implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 资源操作日志ID
     */
    @TableId
    private Long resourceOperLogId;

    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 操作类型
     */
    private String operType;

    /**
     * 操作用户
     */
    private String operUser;

    /**
     * 操作描述
     */
    private String operDesc;

    /**
     * 操作参数
     */
    private String operParam;

    /**
     * 版本号
     */
    private String versionNo;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    private LocalDateTime createTime;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    private LocalDateTime updateTime;

    /**
     * 所属企业
     */
    private Long comAcctId;
}

