package com.iwhalecloud.byai.state.domain.assitsant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.Pattern;
import java.util.List;

/**
 * 资源权限查询请求DTO
 */
@Data
@Schema(description = "资源权限查询请求参数")
public class ResourcePrivilegeQueryRequestDto {

    @Schema(description = "授权类型列表：INNER-内部授权，OUTER-外部授权。如果为空则查询所有类型", example = "[\"INNER\", \"OUTER\"]")
    private List<@Pattern(regexp = "^(INNER|OUTER)$", message = "授权类型只能是INNER或OUTER") String> privilegeTypes;

    @Schema(description = "资源类型列表：KNOWLEDGE_BASE-知识库，DATA_BASE-数据库。如果为空则查询所有类型", example = "[\"KNOWLEDGE_BASE\", \"DATA_BASE\"]")
    private List<@Pattern(regexp = "^(KNOWLEDGE_BASE|DATA_BASE)$", message = "资源类型只能是KNOWLEDGE_BASE或DATA_BASE") String> resourceTypes;
}
