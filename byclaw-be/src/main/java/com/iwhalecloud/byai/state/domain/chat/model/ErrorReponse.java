package com.iwhalecloud.byai.state.domain.chat.model;

public class ErrorReponse {
    private java.util.Map<String,Object> quota;
    public java.util.Map<String,Object> getQuota(){return quota;}
    public static ErrorReponse error(Throwable failure) {
        ErrorReponse response=error(failure.getMessage());
        if(failure instanceof com.iwhalecloud.byai.state.common.exception.NasQuotaExceededException exceeded) {
            response.errorCode="NAS_QUOTA_EXCEEDED";response.quota=exceeded.details();
        }
        if(failure instanceof com.iwhalecloud.byai.state.common.exception.StoragePreparingException preparing) {
            response.errorCode="STORAGE_PREPARING";response.quota=preparing.details();
        }
        return response;
    }
    private String statusCode;
    private String message;
    private String errorCode;
    private String details;
    private String timestamp;
    private String path;
    private String traceback;

    public static ErrorReponse error(String errorMessage) {
        ErrorReponse errorReponse = new ErrorReponse();
        errorReponse.setMessage(errorMessage);
        return errorReponse;
    }

    public String getStatusCode() {
        return statusCode;
    }

    public void setStatusCode(String statusCode) {
        this.statusCode = statusCode;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }

    public String getDetails() {
        return details;
    }

    public void setDetails(String details) {
        this.details = details;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getTraceback() {
        return traceback;
    }

    public void setTraceback(String traceback) {
        this.traceback = traceback;
    }

    @Override
    public String toString() {
        return "ErrorReponse{" +
                "statusCode='" + statusCode + '\'' +
                ", message='" + message + '\'' +
                ", errorCode='" + errorCode + '\'' +
                ", details='" + details + '\'' +
                ", timestamp='" + timestamp + '\'' +
                ", path='" + path + '\'' +
                ", traceback='" + traceback + '\'' +
                '}';
    }
}
