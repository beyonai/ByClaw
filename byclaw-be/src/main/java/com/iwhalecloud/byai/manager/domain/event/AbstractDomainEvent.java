package com.iwhalecloud.byai.manager.domain.event;

import lombok.Getter;
import lombok.Setter;
import org.springframework.context.ApplicationEvent;

/**
 * @author he.duming
 * @date 2025-04-17 20:53:20
 * @description TODO
 */
@Getter
@Setter
public abstract class AbstractDomainEvent extends ApplicationEvent {

    /**
     * 事件类型，新增CREATE 修改 UPDATE 删除 DELETE
     */
    protected String eventType;

    public AbstractDomainEvent(Object source) {
        super(source);
    }
}
