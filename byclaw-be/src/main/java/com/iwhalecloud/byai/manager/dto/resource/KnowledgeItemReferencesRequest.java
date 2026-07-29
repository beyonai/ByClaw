package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户 Markdown 文件引用关系查询请求。
 *
 * @author qin.guoquan
 * @date 2026-07-14 19:38:38
 */
@Getter
@Setter
public class KnowledgeItemReferencesRequest {

    @NotNull(message = "知识库资源标识不能为空")
    private Long resourceId;

    @NotBlank(message = "知识库文件路径不能为空")
    private String filePath;

    @Pattern(regexp = "inbound|outbound|all", message = "引用查询方向必须是 inbound、outbound 或 all")
    private String direction;
}
