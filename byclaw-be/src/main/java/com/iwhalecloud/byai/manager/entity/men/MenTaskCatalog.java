package com.iwhalecloud.byai.manager.entity.men;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 任务目录实体类
 * 
 * @author system
 * @since 2024
 */
@Getter
@Setter
@TableName("men_task_catalog")
public class MenTaskCatalog {

    /**
     * 任务目录ID
     */
    @TableId(value = "task_catalog_id", type = IdType.INPUT)
    private Long taskCatalogId;

    /**
     * 目录名称
     */
    private String cataName;

    /**
     * 父目录ID
     */
    private String pCatalogId;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /**
     * 所属企业
     */
    private Long comAcctId;

    /**
     * 任务ID
     */
    private Long taskId;
}