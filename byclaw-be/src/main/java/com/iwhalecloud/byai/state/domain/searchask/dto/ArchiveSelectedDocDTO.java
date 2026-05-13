package com.iwhalecloud.byai.state.domain.searchask.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 选中归档请求：对某次 query 产生的 requestId，将用户选中的 textList 条目进行爬取→MD→上传→落库。
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
public class ArchiveSelectedDocDTO {

    /**
     * 联网搜索请求 ID（来自 /web-search/query 返回的 request.requestId）
     */
    @NotNull(message = "{web.search.archive.requestId.required}")
    private Long requestId;

    /**
     * 会话标识，与 query 时一致；为空或不存在时由服务端统一创建并回填
     */
    private Long sessionId;

    /**
     * 用户选中的 DocChain 文本条目列表（与 query 返回的 textList 中选中的项一致，每项为 Map 含 data、doc_id、chunk_id 等）
     */
    @NotEmpty(message = "{web.search.archive.textList.required}")
    private List<Map<String, Object>> textList;
}
