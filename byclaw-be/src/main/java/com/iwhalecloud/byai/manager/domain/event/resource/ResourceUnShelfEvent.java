package com.iwhalecloud.byai.manager.domain.event.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import lombok.Getter;
import org.springframework.context.ApplicationEvent;

/**
 * @author he.duming
 * @date 2025-12-04 16:07:01
 * @description 资源下架事件
 */
@Getter
public class ResourceUnShelfEvent extends ApplicationEvent {

    private final SsResource ssResource;

    public ResourceUnShelfEvent(SsResource resource) {
        super(resource);
        this.ssResource = resource;
    }
}
