package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_scan_source")
public class ScanSource {

    @TableId(value = "source_id", type = IdType.INPUT)
    private Long sourceId;

    private Long projectId;

    private String sourceName;

    private String sourceType;

    private String config;

    private String cronExpr;

    private String enabled;

    /** 关联目标仓库ID，扫来的需求据此确定开发仓库 */
    private Long repoId;

    /** 需求确认规则 manual人工确认/auto全自动派生/score按分数阈值派生 */
    private String confirmMode;

    /** score模式下自动派生的最低综合分，默认70 */
    private Integer scoreThreshold;

    private Date lastScanTime;

    private String createBy;

    private Date createTime;

    private String updateBy;

    private Date updateTime;

    private String deleteFlag;
}
