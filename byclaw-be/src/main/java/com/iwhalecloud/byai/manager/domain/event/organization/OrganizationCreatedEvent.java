package com.iwhalecloud.byai.manager.domain.event.organization;

import com.iwhalecloud.byai.manager.domain.event.AbstractDomainEvent;

import com.iwhalecloud.byai.manager.entity.organization.Organization;
import lombok.Getter;

/**
 * 组织新增事件
 */
@Getter
public class OrganizationCreatedEvent extends AbstractDomainEvent {

    /**
     * 组织信息
     */
    private final Organization organization;

    /**
     * @param source 事件来源
     * @param organization 组织信息
     */
    public OrganizationCreatedEvent(Object source, Organization organization) {
        super(source);
        this.organization = organization;
    }
}
