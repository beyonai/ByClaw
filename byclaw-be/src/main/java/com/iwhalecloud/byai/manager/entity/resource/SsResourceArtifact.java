package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

/**
 * 资源产物映射表。
 * @author qin.guoquan
 * @date 2026-05-13 20:52:38
 */
@Getter
@Setter
@TableName("ss_resource_artifact")
public class SsResourceArtifact implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.INPUT)
    private Long artifactId;

    private Long resourceId;

    private String resourceBizType;

    private String artifactType;

    private String storageType;

    private String artifactPath;

    private String statusCd;

    private String remark;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private Long comAcctId;
}
