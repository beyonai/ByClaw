package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/** 门户知识库文件计数请求。 */
@Getter
@Setter
public class KnowledgeFileCountRequest {

    @NotNull(message = "{knowledge.resourceId.required}")
    private Long resourceId;
}
