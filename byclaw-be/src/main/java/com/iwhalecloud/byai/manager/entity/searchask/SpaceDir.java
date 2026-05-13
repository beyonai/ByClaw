package com.iwhalecloud.byai.manager.entity.searchask;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

/**
 * 空间目录表实体，对应表：byai_space_dir
 */
@Data
@TableName("byai_space_dir")
public class SpaceDir implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 目录唯一ID */
    @TableId
    private Long dirId;

    /** 父级目录ID，0表示一级目录 */
    private Long parentDirId;

    /** 目录名称 */
    private String name;

    /** 目录类型，取值：IMPORT:导入, WEB_SEARCH:联网检索, PERSONAL_KB:个人知识库, ORG_KB:企业知识库, DING_CHAT:钉钉聊天, COLLECT:收藏夹 */
    private String dirType;

    /** 目录排序号，数字越小越靠前 */
    private Integer sort;

    /** 目录描述（可选） */
    private String description;

    /** 创建人ID */
    private Long createBy;

    /** 创建时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /** 会话ID（用于关联操作会话） */
    private Long sessionId;
}
