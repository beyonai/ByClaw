package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import java.util.Date;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;

@Component
public class WecomCliAuthorizationProvider implements ConnectorAuthorizationProvider {

    private static final String ERROR_CODE = "PROVIDER_NOT_IMPLEMENTED";
    private static final String ERROR_MESSAGE = "企业微信授权暂未开放";

    @Override
    public String providerCode() {
        return "wecom-cli";
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        return new AuthorizationStartResult(
            AuthorizationStatus.FAILED,
            null,
            new Date(),
            null,
            null,
            ERROR_CODE,
            ERROR_MESSAGE
        );
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.FAILED,
            null,
            null,
            null,
            null,
            ERROR_CODE,
            ERROR_MESSAGE
        );
    }

    @Override
    public void cancel(AuthorizationSessionContext session) {
        // WeCom authorization is not implemented, so no process can be running.
    }
}
