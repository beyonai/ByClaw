package com.iwhalecloud.byai.state.domain.searchask.dto;

import com.iwhalecloud.byai.manager.entity.searchask.WebCrawlArchiveDoc;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.springframework.format.annotation.DateTimeFormat;

import java.util.Date;
import java.util.List;

/**
 * 按 session 反查时，单次请求的归档项（含 request_id、query、该次请求下的文档列表）
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class SessionArchiveItemDTO {

    /**
     * 归档请求 ID
     */
    private Long requestId;

    /**
     * 用户当时的查询问题
     */
    private String query;

    /**
     * 该次请求的创建时间
     */
    @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 该次请求下的文档归档列表（含文件信息）
     */
    private List<WebCrawlArchiveDoc> docList;
}
