package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.validate.resource.annotion.ValidResourceBizType;
import com.iwhalecloud.byai.manager.validate.resource.annotion.ValidResourceSample;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * 资源DTO
 */
@Getter
@Setter
public class ResourceDto {

    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 外系统编码
     */
    private String systemCode;

    /**
     * 资源来源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceSourcePkId;

    /**
     * 资源业务类型
     */
    @NotBlank(message = "{resourcedto.resourcebiztype.notblank}")
    @ValidResourceBizType
    private String resourceBizType;

    /**
     * 资源类型
     */
    private String resourceType;

    /**
     * 资源名称
     */
    @NotBlank(message = "{resourcedto.resourcename.notblank}")
    @Size(max = 128, message = "{resourcedto.resourcename.size}")
    @Pattern(regexp = "^[a-zA-Z\\u4e00-\\u9fa5][a-zA-Z0-9\\u4e00-\\u9fa5_]*$",
        message = "{resourcedto.resourcename.regexp}")
    private String resourceName;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 资源描述
     */
    @NotBlank(message = "{resourcedto.resourcedesc.notblank}")
    @Size(max = 1024, message = "{resourcedto.resourcedesc.size}")
    private String resourceDesc;

    /**
     * 资源图标
     */
    @Size(max = 1024, message = "{resourcedto.avatar.size}")
    private String avatar;

    /**
     * 常见问题
     */
    @ValidResourceSample
    private String sample;

    /**
     * 资源标签
     */
    private String tags;

    /**
     * 索引清单
     */
    private String indexList;

    /**
     * 服务模式
     */
    private String hostType;

    /**
     * 特定类型参数
     */
    private Map<String, Object> param;

    /**
     * 发布渠道
     */
    private List<PublishChannel> publishChannels;

    /***
     * 用于回显已有的管理组织
     */
    private Long manOrgId;

    private String createBy;

    /**
     * 资源创建用户名称
     */
    private String createUserName;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    private String manUserId;

    private Long catalogId;

    private String resourceIdStr;

    private Integer resourceStatus;

    private String manOrgName;

    private String manUserName;

    /**
     * 集成方式：默认为NONE，可选：PAGE（页面集成）、INTERFACE（接口集成）
     */
    private String integrationType;

    /**
     * 草稿版本?
     */
    private Long resourceDVerid;

    /**
     * 正式版本?
     */
    private Long resourceRVerid;

    /**
     * 是否发布到业务门户：1-是，0-?
     */
    private Integer publishPortal;

    /**
     * 是否前台调用
     */
    private boolean isFrontAccess = false;

    private boolean isMod = false;

    /**
     * 本地知识?dataset,第三方知识库:external
     */
    private String type;

    /**
     * 插件标识
     */
    private Long pluginMachineId;

    /**
     * topic标识
     */
    private String kdbId;

}
