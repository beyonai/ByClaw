package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/** 门户知识库文件计数请求。 */
@Getter
@Setter
public class KnowledgeFileCountRequest {

    @NotNull(message = "{knowledge.resourceId.required}")
    private Long resourceId;

    /** 知识库内完整路径前缀；不传时保持全库统计，由知识服务校验路径语义。 */
    private List<String> excludePathPrefixList;
}
