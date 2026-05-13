package com.iwhalecloud.byai.manager.dto.ontology;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 工具信息DTO
 * 用于存储从工具集中提取的工具信息
 *
 * @author system
 */
@Getter
@Setter
public class ToolInfo {

    /**
     * 工具编码（对应原字段machineCode）
     */
    private String toolCode;

    /**
     * 工具描述（对应原字段machineDesc）
     */
    private String toolDesc;

    /**
     * 工具名称（对应原字段machineName）
     */
    private String toolName;

    /**
     * 工具ID（对应原字段pluginAppId）
     */
    private String toolId;

    /**
     * 工具集ID（对应原字段pluginMachineId）
     */
    private String toolkitId;

    /**
     * 工具参数列表（预留字段）
     */
    private List<ToolParam> toolParams;
}

