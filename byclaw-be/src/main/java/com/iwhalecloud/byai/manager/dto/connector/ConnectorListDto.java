package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/**
 * 连接器列表返回 DTO。
 */
@Getter
@Setter
public class ConnectorListDto {

    /** 连接器ID */
    private Long connectorId;

    /** 连接器业务编码 */
    private String connectorCode;

    /** 连接器展示名称 */
    private String connectorName;

    /** 连接器类型：SYSTEM / CUSTOM */
    private String connectorType;

    /** 连接器功能简介 */
    private String description;

    /** 当前用户连接启用标识：Y=开启，N=关闭，未绑定则为 null */
    private String enableFlag;
}
