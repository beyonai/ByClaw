package com.iwhalecloud.byai.manager.domain.event.organization;

import org.springframework.context.ApplicationEvent;

import lombok.Getter;

/**
 * 组织删除事件
 */
@Getter
public class OrganizationDeletedEvent extends ApplicationEvent {

    /***
     * 组织标识
     */
    private final Long orgId;

    /**
     * 组织删除事件
     * 
     * @param source 事件源
     * @param orgId 组织标识
     */
    public OrganizationDeletedEvent(Object source, Long orgId) {
        super(source);
        this.orgId = orgId;
    }
}
