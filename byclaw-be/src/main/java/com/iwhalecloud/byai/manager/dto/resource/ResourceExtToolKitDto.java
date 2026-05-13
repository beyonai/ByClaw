package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-30 00:06:50
 * @description 工具集扩展DTO
 */
@Getter
@Setter
public class ResourceExtToolKitDto extends SsResource {

    /**
     * 认证信息
     */
    private String headers;
    
    /**
     * 关联的工具列表
     */
    private List<ResourceExtToolDto> resourceExtToolDtos;
}
