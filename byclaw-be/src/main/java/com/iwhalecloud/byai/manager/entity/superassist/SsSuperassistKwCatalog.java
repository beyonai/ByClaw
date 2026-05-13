package com.iwhalecloud.byai.manager.entity.superassist;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-05-19 16:07:18
 * @description 会话关联文档库目录关系表
 */
@Getter
@Setter
@TableName("ss_superassist_kw_catalog")
public class SsSuperassistKwCatalog {
    /**
     * 主键标识
     */
    @TableId(value = "kw_catalog_id", type = IdType.INPUT)
    private Long kwCatalogId;

    /**
     * 超级助手标识
     */
    private Long superassistId;

    /**
     * 会话类型，固定会话只?CHAT_BI : 鲸智-问数; WRITER: 鲸智-慧笔; DIGI_HUM: 鲸智-鲸灵; AGENT: 普通数字员?
     */
    private String sessionType;

    /**
     * YES:是，NO：否
     */
    private String isLastSession;

    /**
     * 会话标识
     */
    private Long sessionId;

    /**
     * 助理关联唯一个知识库id，用于存储上传的文档
     */
    private Long sessionDatasetid;

    /**
     * 目录标识
     */
    private Long catalogId;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 创建人
     */
    private Long createUser;

    /**
     * 企业标识
     */
    private Long enterpriseId;

}