package com.iwhalecloud.byai.state.domain.searchask.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 联网搜索请求 DTO
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
public class WebSearchDocDTO {

    /**
     * 查询问题（必填）
     */
    @NotBlank(message = "{web.search.archive.query.required}")
    @Size(max = 2000, message = "{web.search.archive.query.maxlength}")
    private String query;

    /**
     * 会话标识，用于关联多次询问；为空或不存在时由服务端统一创建新会话
     */
    private Long sessionId;

    /**
     * 透传 DocChain，默认 394
     */
    private String topicId;

    /**
     * 条数，默认 10
     */
    @Max(value = 100, message = "{web.search.archive.size.max}")
    private Integer size;
}
