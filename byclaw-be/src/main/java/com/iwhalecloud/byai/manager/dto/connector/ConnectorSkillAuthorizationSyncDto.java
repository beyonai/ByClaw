package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** Sanitized result returned to a connector Skill after credential verification and state sync. */
@Getter
@Setter
public class ConnectorSkillAuthorizationSyncDto {

    private String connectorCode;

    private Boolean connected;

    private String errorCode;

    private Boolean retryable;

    public static ConnectorSkillAuthorizationSyncDto connected(String connectorCode) {
        ConnectorSkillAuthorizationSyncDto result = new ConnectorSkillAuthorizationSyncDto();
        result.setConnectorCode(connectorCode);
        result.setConnected(true);
        result.setRetryable(false);
        return result;
    }

    public static ConnectorSkillAuthorizationSyncDto failed(
            String connectorCode,
            String errorCode,
            boolean retryable) {
        ConnectorSkillAuthorizationSyncDto result = new ConnectorSkillAuthorizationSyncDto();
        result.setConnectorCode(connectorCode);
        result.setConnected(false);
        result.setErrorCode(errorCode);
        result.setRetryable(retryable);
        return result;
    }
}
