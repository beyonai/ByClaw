package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 运营需求实体。
 * 此表仅承载运营项目需求，研发扫描需求仍由 byai_scan_log_item 与历史扫描表维护。
 */
@Getter
@Setter
@TableName("byai_operation_requirement")
public class OperationRequirement {

    @TableId(value = "item_id", type = IdType.INPUT)
    private Long itemId;

    private Long projectId;

    private String title;

    private String description;

    private String operationType;

    private String status;

    private Long assignee;

    private Date dueTime;

    private Integer progress;

    /** 类型专属配置 JSON。 */
    private String config;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
