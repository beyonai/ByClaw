package com.iwhalecloud.byai.state.domain.assitsant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 资源授权请求DTO
 */
@Data
@Schema(description = "助理资源授权请求参数")
public class ResourcePrivilegeRequestDto {
    
    @Schema(description = "授权类型：INNER表示内部授权，OUTER表示外部授权", required = true)
    private String privilegeType;
    
    @Schema(description = "知识资源ID列表")
    private List<Long> knowledgeList;
    
    @Schema(description = "数据资源ID列表")
    private List<Long> dataList;
}
