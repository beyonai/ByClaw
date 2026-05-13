package com.iwhalecloud.byai.manager.domain.event.catalog;

import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import org.springframework.context.ApplicationEvent;
import lombok.Getter;

/**
 * 资源目录更新事件
 */
@Getter
public class ResourceCatalogUpdatedEvent extends ApplicationEvent {
    /**
     * 资源目录信息
     */
    private final SsResourceCatalog ssResourceCatalog;

    /**
     * @param source 事件源
     * @param ssResourceCatalog 资源目录信息
     */
    public ResourceCatalogUpdatedEvent(Object source, SsResourceCatalog ssResourceCatalog) {
        super(source);
        this.ssResourceCatalog = ssResourceCatalog;
    }
}
