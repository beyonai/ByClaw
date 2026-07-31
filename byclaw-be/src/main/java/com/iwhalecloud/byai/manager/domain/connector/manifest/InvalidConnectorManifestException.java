package com.iwhalecloud.byai.manager.domain.connector.manifest;

/** 连接器 Runtime Manifest 缺失或违反受信运行契约。 */
public class InvalidConnectorManifestException extends RuntimeException {

    public InvalidConnectorManifestException(String message) {
        super(message);
    }

    public InvalidConnectorManifestException(String message, Throwable cause) {
        super(message, cause);
    }
}
