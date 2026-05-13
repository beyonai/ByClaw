package com.iwhalecloud.byai.manager.domain.event.organization;

import com.iwhalecloud.byai.manager.entity.organization.Organization;
import org.springframework.context.ApplicationEvent;

import lombok.Getter;

/**
 * 组织更新事件
 */
@Getter
public class OrganizationUpdatedEvent extends ApplicationEvent {

    /**
     * 组织信息
     */
    private final Organization organization;

    /**
     * 组织更新事件
     * 
     * @param source 事件来源
     * @param organization 组织信息
     */
    public OrganizationUpdatedEvent(Object source, Organization organization) {
        super(source);
        this.organization = organization;

    }
}
