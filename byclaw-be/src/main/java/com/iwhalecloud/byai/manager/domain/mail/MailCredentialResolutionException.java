package com.iwhalecloud.byai.manager.domain.mail;

/** Safe typed failure for corrupt credential material or unavailable credential infrastructure. */
public class MailCredentialResolutionException extends RuntimeException {
    private final Code code;

    public MailCredentialResolutionException(Code code, Throwable cause) {
        super("Mail credential resolution failed", cause);
        this.code = code;
    }

    public Code code() {
        return code;
    }

    public enum Code {
        INFRASTRUCTURE,
        CORRUPT_CREDENTIAL
    }
}
