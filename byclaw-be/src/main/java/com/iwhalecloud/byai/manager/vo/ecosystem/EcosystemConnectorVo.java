package com.iwhalecloud.byai.manager.vo.ecosystem;

import java.util.List;

import lombok.Data;

/**
 * 生态连接器能力视图。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemConnectorVo {

    /**
     * 连接器编码，例如 web、zhihu、github。
     */
    private String connectorCode;

    /**
     * 连接器展示名称。
     */
    private String connectorName;

    /**
     * 连接器分类，例如网页、协作、代码、邮箱。
     */
    private String category;

    /**
     * 当前用户是否可用。
     */
    private Boolean available;

    /**
     * 是否必须依赖本机采集端和浏览器登录态。
     */
    private Boolean requiresLocalAgent;

    /**
     * 支持的运行位置，LOCAL / SERVER。
     */
    private List<String> runLocations;

    /**
     * 支持的认证方式，BROWSER / TOKEN / OAUTH / IMAP / PUBLIC_URL。
     */
    private List<String> authTypes;

    /**
     * 连接器能力清单，例如 read、downloadImages、markdown。
     */
    private List<String> capabilities;

    /**
     * 底层运行时类型，例如 opencli、api。
     */
    private String runtimeType;

    /**
     * 连接器启用状态。
     */
    private String status;

    /**
     * 连接器说明。
     */
    private String description;
}
