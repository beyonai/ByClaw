package com.iwhalecloud.byai.manager.domain.connector.service;

import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;

/** Runtime Manifest 环境变量与已有用户参数或其他连接器参数冲突。 */
public class ConnectorParameterConflictException extends InvalidConnectorManifestException {

    public ConnectorParameterConflictException(String paramKey) {
        super("Connector environment parameter key conflict: " + paramKey);
    }
}
