package com.iwhalecloud.byai.manager.entity.memory;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * 记忆库表
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
@TableName("memory_library")
public class MemoryLibrary {

    /**
     * 主键ID
     */
    @TableId(value = "library_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long libraryId;

    /**
     * 记忆库ID（从智能体接口返回的libraryId）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long memLibraryId;

    /**
     * 数字员工ID（agentId）或超级助手ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long agentId;

    /**
     * 用户ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    /**
     * 类型：SUPER_ASSISTANT--超级助手，DIGITAL_EMPLOYEE--数字员工
     */
    private String libraryType;

    /**
     * 是否启用：1--启用，0--禁用（默认启用）
     */
    private Integer isEnabled;

    /**
     * 创建人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long createBy;

    /**
     * 修改人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 修改时间
     */
    private Date updateTime;
}

