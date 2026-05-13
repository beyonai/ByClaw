package com.iwhalecloud.byai.manager.application.service.event.handler;

import java.util.HashMap;
import java.util.Map;
import com.iwhalecloud.byai.manager.domain.event.catalog.ResourceCatalogCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.catalog.ResourceCatalogDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.catalog.ResourceCatalogUpdatedEvent;
import com.iwhalecloud.byai.common.constants.events.ResourceCatalogEventType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.google.common.collect.ImmutableMap;
import com.iwhalecloud.byai.manager.application.service.event.base.BaseEventHandlerService;
import com.iwhalecloud.byai.manager.infrastructure.kafka.ZlogAdapter;

/**
 * @author he.duming
 * @date 2025-12-04 14:53:53
 * @description TODO
 */
@Component
public class ResourceCatalogEventHandlerService extends BaseEventHandlerService {

    private static final Logger logger = LoggerFactory.getLogger(ResourceCatalogEventHandlerService.class);

    /**
     * 事件来源
     */
    private static final String SOURCE_RESOURCE = "catalogService";

    /**
     * 同步kafka资源主题
     */
    private static final String RESOURCE_CATALOG_EVENTS_TOPIC = "resource-catalog-events";

    @Autowired(required = false)
    private ZlogAdapter zlogAdapter;

    /**
     * 处理资源目录
     *
     * @param event 资源目录创建事件
     */
    public void handleResourceCatalogCreatedEvent(ResourceCatalogCreatedEvent event) {
        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_RESOURCE, ResourceCatalogEventType.CREATE));
        jsonMap.put("payload", ImmutableMap.of("resourceCatalog", event.getSsResourceCatalog()));

        logger.info("新增资源目录同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(RESOURCE_CATALOG_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

    /**
     * 处理资源目录更新事件
     *
     * @param event 资源目录更新事件
     */
    public void handleResourceCatalogUpdatedEvent(ResourceCatalogUpdatedEvent event) {
        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_RESOURCE, ResourceCatalogEventType.UPDATE));
        jsonMap.put("payload", ImmutableMap.of("resourceCatalog", event.getSsResourceCatalog()));

        logger.info("更新资源目录同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(RESOURCE_CATALOG_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

    /**
     * 处理资源目录删除事件
     *
     * @param event 资源目录删除事件
     */
    public void handleResourceCatalogDeletedEvent(ResourceCatalogDeletedEvent event) {
        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> users = new HashMap<>(2);
        users.put("catalogId", event.getCatalogId());

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_RESOURCE, ResourceCatalogEventType.DELETE));
        jsonMap.put("payload", ImmutableMap.of("resourceCatalog", users));

        logger.info("删除资源目录同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(RESOURCE_CATALOG_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

}
