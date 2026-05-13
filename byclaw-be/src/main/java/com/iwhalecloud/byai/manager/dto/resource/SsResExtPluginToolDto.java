package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 插件工具资源扩展DTO，用于封装插件工具的详细信息 包括插件资源ID和请求头等扩展属性 继承自SsResExtPlugintool实体类
 *
 * @author zht
 * @version 1.0
 * @date 2025/7/10
 */
@EqualsAndHashCode(callSuper = true)
@Data
public class SsResExtPluginToolDto extends SsResExtTool {
    /**
     * 插件资源ID，对应插件工具的资源唯一标识
     */
    private Long pluginResourceId;

    /**
     * 插件请求头信息，通常为JSON字符串，描述调用插件时所需的header内容
     */
    private String headers;
}
