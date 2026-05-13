package com.iwhalecloud.byai.state.domain.assitsant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * 资源权限查询响应DTO
 */
@Data
@Schema(description = "资源权限查询响应")
public class ResourcePrivilegeResponseDto {
    
    @Schema(description = "资源类型")
    private String resourceType;
    
    @Schema(description = "资源类型描述")
    private String resourceTypeDesc;
    
    @Schema(description = "该类型下的资源列表")
    private List<ResourceInfo> resourceList;
    
    @Schema(description = "授权类型")
    private String privilegeType;
    
    /**
     * 资源信息
     */
    @Data
    @Schema(description = "资源信息")
    public static class ResourceInfo {
        @Schema(description = "资源ID")
        private Long resourceId;
        
        @Schema(description = "资源名称")
        private String resourceName;
        
        @Schema(description = "授权时间")
        private Date createTime;
    }
}
