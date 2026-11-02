package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

public class DingtalkRobotConfigValidationException extends RuntimeException {

    private final String messageKey;

    private final Object[] messageArguments;

    public DingtalkRobotConfigValidationException(String message) {
        this(message, "dingtalk.robot.config.invalid");
    }

    /** 保留日志诊断信息，通过独立文案键向用户展示可操作的错误原因。 */
    public DingtalkRobotConfigValidationException(String message, String messageKey, Object... messageArguments) {
        super(message);
        this.messageKey = messageKey;
        this.messageArguments = messageArguments.clone();
    }

    public String getMessageKey() {
        return messageKey;
    }

    public Object[] getMessageArguments() {
        return messageArguments.clone();
    }
}
