package com.iwhalecloud.byai.common.integration.security;

/** Stable transport error; never includes credentials or caller-supplied values. */
public class InternalServiceSecurityException extends RuntimeException {
    private final int status;
    public InternalServiceSecurityException(int status, String errorCode) { super(errorCode); this.status = status; }
    public int status() { return status; }
}
