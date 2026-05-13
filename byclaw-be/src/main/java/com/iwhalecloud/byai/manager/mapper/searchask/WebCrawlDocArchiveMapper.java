package com.iwhalecloud.byai.manager.mapper.searchask;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.searchask.WebCrawlArchiveDoc;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 联网搜索文档归档表 Mapper
 * <p>
 * 负责 web_crawl_doc_archive 表的持久化与查询。
 * </p>
 *
 * @author system
 */
public interface WebCrawlDocArchiveMapper extends BaseMapper<WebCrawlArchiveDoc> {

    /**
     * 新增文档归档记录
     *
     * @param record 文档归档实体
     * @return 影响行数
     */
    int insert(WebCrawlArchiveDoc record);

    /**
     * 按 request_id 查询该次请求下的所有文档归档
     *
     * @param requestId 归档请求ID
     * @return 文档归档列表
     */
    List<WebCrawlArchiveDoc> listByRequestId(@Param("requestId") Long requestId);

    /**
     * 批量新增文档归档记录（兼容 MySQL、PostgreSQL；Oracle 需使用 databaseId 或逐条插入）
     *
     * @param list 文档归档实体列表
     * @return 影响行数
     */
    int insertBatch(@Param("list") List<WebCrawlArchiveDoc> list);
}
