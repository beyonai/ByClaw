package com.iwhalecloud.byai.manager.application.service.event;

import com.iwhalecloud.byai.manager.application.service.event.handler.OrganizationEventHandlerService;
import com.iwhalecloud.byai.manager.application.service.event.handler.ResourceCatalogEventHandlerService;
import com.iwhalecloud.byai.manager.domain.event.catalog.ResourceCatalogCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.catalog.ResourceCatalogDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.catalog.ResourceCatalogUpdatedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationUpdatedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersUpdatedEvent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.manager.application.service.event.handler.UsersEventHandlerService;

/**
 * 领域事件监听器
 */
@Component
public class DomainEventListener {

    @Autowired
    private UsersEventHandlerService usersEventHandlerService;

    @Autowired
    private OrganizationEventHandlerService organizationEventHandlerService;

    @Autowired
    private ResourceCatalogEventHandlerService resourceCatalogEventHandlerService;

    /**
     * 监听用户创建事件
     * 
     * @param event 用户创建事件
     */
    @EventListener
    public void handleUserCreatedEvent(UsersCreatedEvent event) {
        usersEventHandlerService.handleUserCreatedEvent(event);
    }

    /**
     * 监听用户更新事件
     * 
     * @param event 用户更新事件
     */
    @EventListener
    public void handleUserUpdatedEvent(UsersUpdatedEvent event) {
        usersEventHandlerService.handleUserUpdatedEvent(event);
    }

    /**
     * 监听用户删除事件
     * 
     * @param event 用户删除事件
     */
    @EventListener
    public void handleUserDeletedEvent(UsersDeletedEvent event) {
        usersEventHandlerService.handleUserDeletedEvent(event);
    }

    @EventListener
    public void handleOrganizationCreatedEvent(OrganizationCreatedEvent event) {
        organizationEventHandlerService.handleOrganizationCreatedEvent(event);
    }

    /***
     * 组织更新事件
     *
     * @param event 组织更新事件
     */
    @EventListener
    public void handleOrganizationUpdatedEvent(OrganizationUpdatedEvent event) {
        organizationEventHandlerService.handleOrganizationUpdatedEvent(event);
    }

    /**
     * 组织删除事件
     *
     * @param event 组织删除事件
     */
    @EventListener
    public void handleOrganizationDeletedEvent(OrganizationDeletedEvent event) {
        organizationEventHandlerService.handleOrganizationDeletedEvent(event);
    }


    /**
     * 监听资源目录创建事件
     *
     * @param event 资源目录创建事件
     */
    @EventListener
    public void handleResourceCatalogCreatedEvent(ResourceCatalogCreatedEvent event) {
        resourceCatalogEventHandlerService.handleResourceCatalogCreatedEvent(event);
    }

    /**
     * 监听资源目录更新事件
     *
     * @param event 资源目录更新事件
     */
    @EventListener
    public void handleUserUpdatedEvent(ResourceCatalogUpdatedEvent event) {
        resourceCatalogEventHandlerService.handleResourceCatalogUpdatedEvent(event);
    }

    /**
     * 监听资源目录删除
     *
     * @param event 资源目录删除事件
     */
    @EventListener
    public void handleUserDeletedEvent(ResourceCatalogDeletedEvent event) {
        resourceCatalogEventHandlerService.handleResourceCatalogDeletedEvent(event);
    }

}
