package com.iwhalecloud.byai.manager.entity.searchask;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Date;

/**
 * 联网搜索归档请求表实体
 * <p>
 * 对应表：web_crawl_request。一次 DocChain 搜索一条记录，request_id 即主键，由 SequenceService.nextVal() 生成。
 * </p>
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
@TableName("byai_web_crawl_request")
public class WebCrawlRequest {

    /**
     * 归档请求唯一标识，一次搜索一个，SequenceService.nextVal() 生成
     */
    @TableId(value = "request_id", type = IdType.INPUT)
    private Long requestId;

    /**
     * 会话标识，按 session_id 可查该会话下所有 query 与 request_id
     */
    private Long sessionId;

    /**
     * 用户查询问题
     */
    private String query;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 创建人
     */
    private Long createBy;
}
