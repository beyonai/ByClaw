package com.iwhalecloud.byai.manager.entity.devloop;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 项目状态：一个项目在每个维度下一条当前状态。
 */
@Getter
@Setter
@TableName("byai_project_task_status")
public class ProjectTaskStatus {

    /** 主键ID */
    @TableId(value = "status_id", type = IdType.INPUT)
    private Long statusId;

    /** 项目ID */
    private Long projectId;

    /** 状态维度：会话状态 / 业务状态 / ... */
    private String dimensionName;

    /** 状态代码：IN_PROGRESS / REQUIREMENT / ... */
    private String statusCode;

    /** 状态名称：进行中 / 需求阶段 / ... */
    private String statusName;

    /** 状态描述，如知识采集 */
    private String statusDesc;

    /** 维度展示排序 */
    private Integer sortOrder;

    /** 记录状态：00A 有效，00X 无效 */
    private String statusCd;

    /** 创建人 */
    private Long createBy;

    /** 创建时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新人 */
    private Long updateBy;

    /** 更新时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
