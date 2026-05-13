package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;
import java.util.Map;

/**
 * 资源引用信息
 */
@Data
public class ResourceReferenceDto implements Serializable {

    /**
     * 被引用资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long referencedResourceId;

    /**
     * 被引用资源名称
     */
    private String referencedResourceName;

    /**
     * 被引用资源类型
     */
    private String referencedResourceType;

    /**
     * 引用类型
     */
    private String referenceType;

    /**
     * 引用配置
     */
    private Map<String, Object> referenceConfig;

    /**
     * 引用时间
     */
    private Date referenceTime;

    /**
     * 被引用资源状态
     */
    private Integer referencedResourceStatus;
}
