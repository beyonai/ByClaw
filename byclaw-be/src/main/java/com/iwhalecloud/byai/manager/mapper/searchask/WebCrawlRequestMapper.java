package com.iwhalecloud.byai.manager.mapper.searchask;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.searchask.WebCrawlRequest;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 联网搜索归档请求表 Mapper
 * <p>
 * 负责 web_crawl_request 表的持久化与查询。
 * </p>
 *
 * @author system
 */
public interface WebCrawlRequestMapper extends BaseMapper<WebCrawlRequest> {

    /**
     * 新增归档请求记录
     *
     * @param record 请求实体
     * @return 影响行数
     */
    int insert(WebCrawlRequest record);

    /**
     * 按会话标识查询该会话下所有归档请求（按创建时间排序）
     *
     * @param sessionId 会话标识
     * @return 请求列表
     */
    List<WebCrawlRequest> listBySessionId(@Param("sessionId") Long sessionId);
}
