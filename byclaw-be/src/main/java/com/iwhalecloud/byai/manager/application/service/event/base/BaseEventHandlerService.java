package com.iwhalecloud.byai.manager.application.service.event.base;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.common.util.DateUtils;

/**
 * 事件处理服务
 */
@Service
public class BaseEventHandlerService {

    /**
     * 构建元数据信息，协议头格式
     *
     * @param source 事件来源，用户:userService 组织 organizationService
     * @param eventType 事件类型
     * @return Map
     */
    protected Map<String, Object> buildMetadata(String source, String eventType) {

        Map<String, Object> metadata = new HashMap<String, Object>(5);

        // 事件唯一标识UUID
        metadata.put("eventId", UUID.randomUUID().toString());

        // 事件类型
        metadata.put("eventType", eventType);

        // 事件时间,格式 2023-04-08 10:30:00
        metadata.put("eventTime", DateUtils.getFormatedDateTime(new Date()));

        // 事件来源,用户:userService 组织 organizationService
        metadata.put("source", source);

        // 协议版本,暂定1.0
        metadata.put("version", "1.0");

        return metadata;
    }
}
