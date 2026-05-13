package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.util.Date;

/**
 * 资源事件消息DTO 用于Kafka消息队列的资源变更通知
 */
@Data
public class ResourceEventMessage {

    /**
     * 消息载荷
     */
    private Payload payload;

    /**
     * 事件元数据
     */
    private Metadata metadata;

    /**
     * 消息载荷
     */
    @Data
    public static class Payload {

        /**
         * 资源对象
         */
        private ResourceInfo resource;
    }

    /**
     * 资源信息
     */
    @Data
    public static class ResourceInfo {

        /**
         * 资源ID
         */
        private Long resourceId;

        /**
         * 资源外系统ID
         */
        private Long resourceSourcePkId;

        private Long userId;

        /**
         * 来源系统ID
         */
        private Long resourceSourceId;

        /**
         * 资源名称
         */
        private String resourceName;

        /**
         * 资源唯一编码
         */
        private String resourceCode;

        private String resourceType;

        /**
         * 资源描述
         */
        private String resourceDesc;

        /**
         * 资源业务类型
         */
        private String resourceBizType;

        /**
         * 资源图标
         */
        private String avatar;

        /**
         * 外系统编码
         */
        private String systemCode;

        /**
         * 资源状态
         */
        private Integer resourceStatus;

        /**
         * 资源创建者
         */
        private Long createBy;

        /**
         * 资源管理员
         */
        private String manUserId;

        /**
         * 组织id
         */
        private Long manOrgId;

        /**
         * 创建时间
         */
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private Date createTime;

        /**
         * 目录id
         */
        private Long catalogId;

        /**
         * 企业Id
         */
        private Long enterpriseId;

        /**
         * 是否发布业务门户
         */
        private Integer publishPortal;

        /**
         * 数字员工配置（JSON格式，包含modelInfo、descText等）
         */
        private String prologue;

        /**
         * 终端类型:ALL全端，PC端，APP端，
         */
        private String terminal;

    }

    /**
     * 事件元数据
     */
    @Data
    public static class Metadata {

        /**
         * 事件时间
         */
        private String eventTime;

        /**
         * 事件ID
         */
        private String eventId;

        /**
         * 事件类型
         */
        private String eventType;

        /**
         * 事件来源
         */
        private String source;

        /**
         * 版本号
         */
        private String version;
    }
}
