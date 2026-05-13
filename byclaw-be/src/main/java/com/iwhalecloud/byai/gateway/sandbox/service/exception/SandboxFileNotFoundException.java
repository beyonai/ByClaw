package com.iwhalecloud.byai.gateway.sandbox.service.exception;

public class SandboxFileNotFoundException extends RuntimeException {
    public SandboxFileNotFoundException(String userCode, String path) {
        super("Sandbox file not found: userCode=" + userCode + ", path=" + path);
    }
}
