package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户知识库路径模式匹配请求。
 *
 * @author qin.guoquan
 * @date 2026-07-14 19:38:38
 */
@Getter
@Setter
public class KnowledgeGlobRequest {

    @NotNull(message = "知识库资源标识不能为空")
    private Long resourceId;

    @NotBlank(message = "匹配路径规则不能为空")
    private String pathRule;
}
