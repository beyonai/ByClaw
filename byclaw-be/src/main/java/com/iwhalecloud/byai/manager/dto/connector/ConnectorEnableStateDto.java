package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** 消息 metadata 使用的连接器开启状态。 */
@Getter
@Setter
public class ConnectorEnableStateDto {

    private String connectorCode;

    private Boolean enabled;
}
