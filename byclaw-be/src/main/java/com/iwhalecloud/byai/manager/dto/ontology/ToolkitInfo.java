package com.iwhalecloud.byai.manager.dto.ontology;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 工具集信息DTO
 * 用于存储工具集的基本信息和工具列表
 *
 * @author system
 */
@Getter
@Setter
public class ToolkitInfo {

    /**
     * 工具集ID
     */
    private String id;


    /**
     * 工具集介绍
     */
    private String intro;

    /**
     * 工具集名称
     */
    private String name;

    /**
     * 工具列表
     */
    private List<ToolInfo> toolList;
}

