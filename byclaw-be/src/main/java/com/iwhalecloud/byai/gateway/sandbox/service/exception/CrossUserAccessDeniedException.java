package com.iwhalecloud.byai.gateway.sandbox.service.exception;

public class CrossUserAccessDeniedException extends RuntimeException {
    public CrossUserAccessDeniedException(String userCode, String path) {
        super("Cross-user access denied: userCode=" + userCode + ", path=" + path);
    }
}
