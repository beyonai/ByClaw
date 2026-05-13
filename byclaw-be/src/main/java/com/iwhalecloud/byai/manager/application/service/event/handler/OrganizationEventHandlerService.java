package com.iwhalecloud.byai.manager.application.service.event.handler;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.HashMap;
import java.util.Map;

import com.iwhalecloud.byai.manager.application.service.event.base.BaseEventHandlerService;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationUpdatedEvent;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.google.common.collect.ImmutableMap;
import com.iwhalecloud.byai.common.constants.events.OrganizationEventType;
import com.iwhalecloud.byai.manager.infrastructure.kafka.ZlogAdapter;

/**
 * 组织发布kafka事件
 */
@Component
public class OrganizationEventHandlerService extends BaseEventHandlerService {

    private static final Logger logger = LoggerFactory.getLogger(OrganizationEventHandlerService.class);


    /**
     * 事件来源
     */
    private static final String SOURCE_ORGANIZATION = "organizationService";

    /**
     * 同步kafka组织主题
     */
    private static final String ORGANIZATION_EVENTS_TOPIC = "organization-events";

    @Autowired(required = false)
    private ZlogAdapter zlogAdapter;

    /**
     * 新增组织事件
     * 
     * @param event 新增组织事件
     */
    public void handleOrganizationCreatedEvent(OrganizationCreatedEvent event) {

        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_ORGANIZATION, OrganizationEventType.CREATE));
        jsonMap.put("payload", ImmutableMap.of("organization", this.buildOrganization(event.getOrganization())));

        logger.info("新增组织同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(ORGANIZATION_EVENTS_TOPIC, JSON.toJSONString(jsonMap));

    }

    /***
     * 组织更新事件
     * 
     * @param event 组织更新事件
     */
    public void handleOrganizationUpdatedEvent(OrganizationUpdatedEvent event) {

        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_ORGANIZATION, OrganizationEventType.UPDATE));
        jsonMap.put("payload", ImmutableMap.of("organization", this.buildOrganization(event.getOrganization())));

        logger.info("修改组织同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(ORGANIZATION_EVENTS_TOPIC, JSON.toJSONString(jsonMap));

    }

    /**
     * 组织删除事件
     * 
     * @param event 组织删除事件
     */
    public void handleOrganizationDeletedEvent(OrganizationDeletedEvent event) {

        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", buildMetadata(SOURCE_ORGANIZATION, OrganizationEventType.DELETE));
        jsonMap.put("payload", ImmutableMap.of("organization", ImmutableMap.of("orgId", event.getOrgId())));

        logger.info("删除组织同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(ORGANIZATION_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

    /**
     * 构建组织参数
     * 
     * @param organization 组织
     * @return Map
     */
    private Map<String, Object> buildOrganization(Organization organization) {
        Map<String, Object> organizationMap = new HashMap<>(10);
        organizationMap.put("orgId", organization.getOrgId());
        organizationMap.put("orgCode", organization.getOrgCode());
        organizationMap.put("orgName", organization.getOrgName());
        organizationMap.put("orgIndex", organization.getOrgIndex());
        organizationMap.put("orgLevel", organization.getOrgLevel());
        organizationMap.put("parentOrgId", organization.getParentOrgId());
        return organizationMap;
    }

}
