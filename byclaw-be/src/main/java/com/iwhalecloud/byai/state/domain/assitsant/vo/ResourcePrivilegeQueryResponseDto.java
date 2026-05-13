package com.iwhalecloud.byai.state.domain.assitsant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * 资源权限查询响应DTO
 * 包含超级助手资源权限表和通用权限授权表的联合查询结果
 */
@Data
@Schema(description = "资源权限查询响应")
public class ResourcePrivilegeQueryResponseDto {
    
    @Schema(description = "资源类型")
    private String resourceType;
    
    @Schema(description = "资源类型描述")
    private String resourceTypeDesc;
    
    @Schema(description = "授权类型：INNER-内部授权，OUTER-外部授权")
    private String privilegeType;
    
    @Schema(description = "该类型下的资源列表")
    private List<ResourceInfo> resourceList;
    
    @Schema(description = "数据来源：SUPERASSIST-超级助手资源权限表，GENERAL-通用权限授权表")
    private String dataSource;
    
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

        @Schema(description = "资源业务类型")
        private String resourceBizType;
        
        @Schema(description = "资源描述")
        private String resourceDesc;
        
        @Schema(description = "授权时间")
        private Date createTime;
        
        @Schema(description = "授权类型描述")
        private String privilegeTypeDesc;
        
        @Schema(description = "数据来源：SUPERASSIST-超级助手资源权限表，GENERAL-通用权限授权表")
        private String dataSource;
    }
}
