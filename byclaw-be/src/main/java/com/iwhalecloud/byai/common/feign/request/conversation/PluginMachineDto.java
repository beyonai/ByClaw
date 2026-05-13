package com.iwhalecloud.byai.common.feign.request.conversation;

import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;

/**
 * 插件工具DTO 包含插件工具的基信息
 */
@Getter
@Setter
public class PluginMachineDto implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 主体类型
     */
    private String bodyType;

    /**
     * 代码类型
     */
    private Integer codeType;

    /**
     * 创建时间
     */
    private Long createTime;

    /**
     * 调试状态
     */
    private Integer debugStatus;

    /**
     * 是否异步
     */
    private Integer isAsync;

    /**
     * 是否SSE
     */
    private Integer isSse;

    /**
     * 是否使用
     */
    private Integer isUse;

    /**
     * 工具名称
     */
    private String machineName;

    /**
     * 工具编码
     */
    private String machineCode;

    /**
     * 工具描述
     */
    private String machineDesc;

    /**
     * 工具URL
     */
    private String machineUrl;

    /**
     * 插件应用ID
     */
    private String pluginAppId;

    /**
     * 插件工具ID
     */
    private Long pluginMachineId;

    /**
     * 状�?
     */
    private Integer status;

    /**
     * 类型
     */
    private Integer type;

    /**
     * 更新时间
     */
    private Long updateTime;

    /**
     * 版本ID
     */
    private String versionId;
}
