package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** 更新当前用户的连接器全局启用状态。 */
@Getter
@Setter
public class UpdateConnectorEnableRequest {

    private Long connectorId;

    private Boolean enabled;
}
