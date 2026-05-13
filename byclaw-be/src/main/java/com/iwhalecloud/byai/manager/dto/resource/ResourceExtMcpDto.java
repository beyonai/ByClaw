package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcpServer;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-10-30 00:06:50
 * @description TODO
 */
@Getter
@Setter
public class ResourceExtMcpDto extends SsResource {

    private SsResExtMcpServer ssResExtMcpServer;
}
