package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 直接取消订阅DTO
 */
@Getter
@Setter
public class DirectUnsubscribeDto {
    
    /**
     * 需要直接取消订阅的资源ID列表
     */
    private List<Long> idList;
    
    /**
     * 资源类型映射，key为资源ID，value为资源类型
     */
    private Map<String, String> typeMap;
    
    /**
     * 用户ID
     */
    private Long userId;


    /**
     * 直接取消授权的权限列表
     */
    private Map<Long, Set<String>> unSubscribePrivMap;
}