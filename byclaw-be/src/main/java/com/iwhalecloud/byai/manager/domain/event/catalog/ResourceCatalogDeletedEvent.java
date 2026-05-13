package com.iwhalecloud.byai.manager.domain.event.catalog;

import org.springframework.context.ApplicationEvent;

import lombok.Getter;

/**
 * 资源目录删除事件
 */
@Getter
public class ResourceCatalogDeletedEvent extends ApplicationEvent {

    /**
     * 资源目录标识
     */
    private Long catalogId;

    /**
     * 用户删除事件
     * 
     * @param source 事件源
     * @param catalogId 资源目录标识
     */
    public ResourceCatalogDeletedEvent(Object source, Long catalogId) {
        super(source);
        this.catalogId = catalogId;
    }

}
