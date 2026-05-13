package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import java.io.Serial;
import java.io.Serializable;

import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;

/**
 * 数字员工变更事件载荷（JSON 序列化后作为 Pub/Sub 消息体整串发送，或与历史 Stream {@code payload} 字段结构兼容）。
 */
public class DigEmployeeChangeEvent implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private DigEmployeeChangeEventType eventType;
    private Long resourceId;
    private String resourceBizType = ResourceBizTypeEnum.DIG_EMPLOYEE.name();
    private long changedAt;
    private Long version;
    private String source;

    public DigEmployeeChangeEventType getEventType() {
        return eventType;
    }

    public void setEventType(DigEmployeeChangeEventType eventType) {
        this.eventType = eventType;
    }

    public Long getResourceId() {
        return resourceId;
    }

    public void setResourceId(Long resourceId) {
        this.resourceId = resourceId;
    }

    public String getResourceBizType() {
        return resourceBizType;
    }

    public void setResourceBizType(String resourceBizType) {
        this.resourceBizType = resourceBizType;
    }

    public long getChangedAt() {
        return changedAt;
    }

    public void setChangedAt(long changedAt) {
        this.changedAt = changedAt;
    }

    public Long getVersion() {
        return version;
    }

    public void setVersion(Long version) {
        this.version = version;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }
}
