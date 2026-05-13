package com.iwhalecloud.byai.state.domain.searchask.vo;

import java.util.List;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import com.iwhalecloud.byai.state.domain.searchask.dto.WebCrawlArchiveDocDTO;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 选中文档导入响应结果
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ArchiveSelectedDocVO {

    /**
     * 会话标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    /**
     * 该会话下所有归档请求列表（按 request 维度，每项含 request_id、query、create_time、doc_list）
     */
    private List<WebCrawlArchiveDocDTO> archiveDocs;
}
