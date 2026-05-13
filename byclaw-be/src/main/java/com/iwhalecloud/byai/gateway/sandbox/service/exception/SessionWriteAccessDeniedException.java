package com.iwhalecloud.byai.gateway.sandbox.service.exception;

public class SessionWriteAccessDeniedException extends RuntimeException {
    public SessionWriteAccessDeniedException(String requestedSessionId, String pathSessionId, String path) {
        super("Session write access denied: requested sessionId=" + requestedSessionId
              + " but path belongs to sessionId=" + pathSessionId + ", path=" + path);
    }
}
