package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 资源发布结果DTO
 */
@Data
public class ResourcePublishResult {
    
    /**
     * 是否全部成功
     */
    private boolean success = true;
    
    /**
     * 成功的资源ID列表
     */
    private List<Long> successResourceIds = new ArrayList<>();
    
    /**
     * 失败的资源ID列表
     */
    private List<Long> failResourceIds = new ArrayList<>();
    
    /**
     * 错误消息列表
     */
    private List<String> errorMessages = new ArrayList<>();
}