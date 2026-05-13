package com.iwhalecloud.byai.manager.entity.searchask;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Date;

/**
 * 联网搜索文档归档表实体
 * <p>
 * 对应表：web_crawl_doc_archive。每条 DocChain 文本结果一条记录，通过 request_id 关联 web_crawl_request。
 * minio_file_id 关联 byai_files 表 file_id，上传 MinIO 后落库 byai_files 取得。
 * </p>
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
@TableName("byai_web_crawl_archive_doc")
public class WebCrawlArchiveDoc {

    /**
     * 主键
     */
    @TableId(value = "doc_archive_id", type = IdType.INPUT)
    private Long docArchiveId;

    /**
     * 归属的归档请求ID
     */
    private Long requestId;

    /**
     * 标题，来源于 heading_chain
     */
    private String title;

    /**
     * 来源URL
     */
    private String sourceUrl;

    /**
     * 内容片段，来源于 content，作为备选
     */
    private String contentSnippet;

    /**
     * 爬取状态：SUCCESS-成功 FAILED-失败
     */
    private String status;

    /**
     * 关联 byai_files 表 file_id，上传 MinIO 后落库 byai_files 取得
     */
    private Long fileId;

    /**
     * 爬取失败原因，失败时入库
     */
    private String failureReason;

    /**
     * 相似度得分
     */
    private Double score;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 创建人
     */
    private Long createBy;
}
