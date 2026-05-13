package com.iwhalecloud.byai.manager.domain.event.catalog;

import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import org.springframework.context.ApplicationEvent;
import lombok.Getter;

/**
 * 资源目录创建事件
 */
@Getter
public class ResourceCatalogCreatedEvent extends ApplicationEvent {

    /**
     * 资源目录信息
     */
    private final SsResourceCatalog ssResourceCatalog;

    /**
     * @param source 事件源
     * @param ssResourceCatalog 资源目录信息
     */
    public ResourceCatalogCreatedEvent(Object source, SsResourceCatalog ssResourceCatalog) {
        super(source);
        this.ssResourceCatalog = ssResourceCatalog;
    }

}
