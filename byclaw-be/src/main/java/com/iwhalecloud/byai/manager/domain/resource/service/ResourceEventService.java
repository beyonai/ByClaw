package com.iwhalecloud.byai.manager.domain.resource.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceEventMessage;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.infrastructure.kafka.ZlogAdapter;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * 资源事件服务 负责向Kafka消息队列发送资源变更通知
 */
@Service
public class ResourceEventService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceEventService.class);

    private static final String EVENT_SOURCE = "resourceService";

    private static final String EVENT_VERSION = "1.0";

    private static final String EVENT_TYPE_SHELF = "resourceShelf";

    private static final String EVENT_TYPE_UNSHELF = "resourceUnshelf";

    private static final String EVENT_TYPE_AUDIT_PASS = "resourceAuditPass";

    private static final String EVENT_TYPE_AUDIT_REJECT = "resourceAuditReject";

    // 统一的资源事件主题
    private static final String RESOURCE_EVENTS_TOPIC = "resource-events";

    @Autowired(required = false)
    private ZlogAdapter zlogAdapter;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private SsResExtDigEmployeeMapper ssResExtDigEmployeeMapper;

    /**
     * 发送资源上架事件
     * 
     * @param resource 资源对象
     */
    public void sendResourceShelfEvent(SsResource resource) {
        try {
            ResourceEventMessage message = createResourceEventMessage(resource, EVENT_TYPE_SHELF);
            CompletableFuture<SendResult<String, String>> send = sendMessage(message);
            SendResult<String, String> result = send.get();
            LOGGER.info("资源上架事件发送成功 topic={}, partition={}, offset={}, resourceId={}",
                result.getRecordMetadata().topic(), result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset(), resource.getResourceId());
        }
        catch (Exception e) {
            LOGGER.error("资源上架事件发送失败 resourceId={}, error={}", resource.getResourceId(), e.getMessage(), e);
            throw new BaseException(I18nUtil.get("resource.event.shelf.failed"), e);
        }
    }

    /**
     * 发送资源下架事件
     * 
     * @param resource 资源对象
     */
    public void sendResourceUnshelfEvent(SsResource resource) {
        try {
            ResourceEventMessage message = createResourceEventMessage(resource, EVENT_TYPE_UNSHELF);
            CompletableFuture<SendResult<String, String>> send = sendMessage(message);
            SendResult<String, String> result = send.get();
            LOGGER.info("资源下架事件发送成功 topic={}, partition={}, offset={}, resourceId={}",
                result.getRecordMetadata().topic(), result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset(), resource.getResourceId());
        }
        catch (Exception e) {
            LOGGER.error("资源下架事件发送失败 resourceId={}, error={}", resource.getResourceId(), e.getMessage(), e);
            throw new BaseException(I18nUtil.get("resource.event.unshelf.failed"), e);
        }
    }

    /**
     * 创建资源事件消息
     *
     * @param resource 资源对象
     * @param eventType 事件类型
     * @return 资源事件消息
     */
    private ResourceEventMessage createResourceEventMessage(SsResource resource, String eventType) {
        ResourceEventMessage message = new ResourceEventMessage();

        // 创建Payload
        ResourceEventMessage.Payload payload = new ResourceEventMessage.Payload();
        ResourceEventMessage.ResourceInfo resourceInfo = new ResourceEventMessage.ResourceInfo();

        // 设置资源信息
        resourceInfo.setResourceId(resource.getResourceId());
        resourceInfo.setResourceSourcePkId(resource.getResourceSourcePkId());
        resourceInfo.setResourceType(resource.getResourceType());
        resourceInfo.setResourceSourceId(resource.getResourceSourcePkId()); // 使用resourceSourcePkId作为sourceId
        resourceInfo.setResourceName(resource.getResourceName());
        resourceInfo.setUserId(CurrentUserHolder.getCurrentUserId());
        resourceInfo.setResourceCode(resource.getResourceCode());
        resourceInfo.setResourceDesc(resource.getResourceDesc());
        resourceInfo.setResourceBizType(resource.getResourceBizType());
        resourceInfo.setAvatar(resource.getAvatar());
        resourceInfo.setSystemCode(resource.getSystemCode());
        resourceInfo.setResourceStatus(resource.getResourceStatus());
        resourceInfo.setCreateBy(resource.getCreateBy());
        resourceInfo.setManUserId(resource.getManUserId());
        resourceInfo.setManOrgId(resource.getManOrgId());
        resourceInfo.setCreateTime(resource.getCreateTime());
        resourceInfo.setCatalogId(resource.getCatalogId());
        resourceInfo.setEnterpriseId(resource.getComAcctId());
        resourceInfo.setPublishPortal(resource.getPublishPortal());

        // 设置终端类型
        SsResExtDigEmployee ssResExtDigEmployee = ssResExtDigEmployeeMapper.selectById(resource.getResourceId());
        if (ssResExtDigEmployee != null) {
            resourceInfo.setTerminal(ssResExtDigEmployee.getTerminal());
            resourceInfo.setPrologue(ssResExtDigEmployee.getPrologue());
        }

        payload.setResource(resourceInfo);
        message.setPayload(payload);

        // 创建Metadata
        ResourceEventMessage.Metadata metadata = new ResourceEventMessage.Metadata();
        metadata.setEventTime(LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        metadata.setEventId(UUID.randomUUID().toString());
        metadata.setEventType(eventType);
        metadata.setSource(EVENT_SOURCE);
        metadata.setVersion(EVENT_VERSION);

        message.setMetadata(metadata);

        return message;
    }

    /**
     * 发送消息到Kafka
     *
     * @param message 消息对象
     */
    private CompletableFuture<SendResult<String, String>> sendMessage(ResourceEventMessage message) throws Exception {
        if (zlogAdapter == null) {
            throw new Exception(I18nUtil.get("resource.event.zlog.adapter.init.failed"));
        }

        String messageJson = objectMapper.writeValueAsString(message);
        return zlogAdapter.send(RESOURCE_EVENTS_TOPIC, messageJson);
    }

    /**
     * 发送资源审核通过事件
     *
     * @param resource 资源对象，包含需要发送审核通过事件的资源信息
     */
    public void sendResourceAuditPassEvent(SsResource resource) {
        try {
            // 创建资源事件消息并发送
            ResourceEventMessage message = createResourceEventMessage(resource, EVENT_TYPE_AUDIT_PASS);
            CompletableFuture<SendResult<String, String>> send = sendMessage(message);
            SendResult<String, String> result = send.get();
            LOGGER.info("资源审核通过事件发送成功 topic={}, partition={}, offset={}, resourceId={}",
                result.getRecordMetadata().topic(), result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset(), resource.getResourceId());
        }
        catch (Exception e) {
            LOGGER.error("资源审核通过事件发送失败 resourceId={}, error={}", resource.getResourceId(), e.getMessage(), e);
            throw new BaseException(I18nUtil.get("resource.event.audit.pass.failed"), e);
        }
    }

    /**
     * 发送资源审核驳回事件
     *
     * @param resource 资源对象，用于创建事件消息并发送
     */
    public void sendResourceAuditRejectEvent(SsResource resource) {
        try {
            // 创建资源事件消息并发送
            ResourceEventMessage message = createResourceEventMessage(resource, EVENT_TYPE_AUDIT_REJECT);
            CompletableFuture<SendResult<String, String>> send = sendMessage(message);
            SendResult<String, String> result = send.get();
            LOGGER.info("资源审核驳回事件发送成功 topic={}, partition={}, offset={}, resourceId={}",
                result.getRecordMetadata().topic(), result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset(), resource.getResourceId());
        }
        catch (Exception e) {
            LOGGER.error("资源审核驳回事件发送失败 resourceId={}, error={}", resource.getResourceId(), e.getMessage(), e);
            throw new BaseException(I18nUtil.get("resource.event.audit.reject.failed"), e);
        }
    }
}
