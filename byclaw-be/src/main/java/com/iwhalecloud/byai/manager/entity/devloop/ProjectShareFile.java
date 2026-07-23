package com.iwhalecloud.byai.manager.entity.devloop;

import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目空间共享文件。
 */
@Getter
@Setter
@TableName("byai_project_share_file")
public class ProjectShareFile {

    @TableId(value = "share_id", type = IdType.INPUT)
    private Long shareId;

    private Long projectId;

    private Long fileId;

    /** 分享链接 */
    private String shareLink;

    private Long createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;
}
