package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

/** Safe OAuth client failure classification; never contains provider response bodies or credentials. */
public class MailOAuth2ClientException extends IllegalStateException {
    private final String code;
    private final boolean retryable;

    public MailOAuth2ClientException(String code, boolean retryable) {
        super("Mail OAuth2 client request failed: " + code);
        this.code = code;
        this.retryable = retryable;
    }

    public MailOAuth2ClientException(String code, boolean retryable, Throwable cause) {
        super("Mail OAuth2 client request failed: " + code, cause);
        this.code = code;
        this.retryable = retryable;
    }

    public String code() { return code; }
    public boolean retryable() { return retryable; }
}
