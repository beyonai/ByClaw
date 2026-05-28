package com.iwhalecloud.byai.gateway.sandbox.model.opendesign;

public class OpenDesignRunContext {

    private final long startedAt;
    private final String prompt;
    private final String userMessageId;
    private final String assistantMessageId;

    public OpenDesignRunContext(long startedAt, String prompt, String userMessageId, String assistantMessageId) {
        this.startedAt = startedAt;
        this.prompt = prompt;
        this.userMessageId = userMessageId;
        this.assistantMessageId = assistantMessageId;
    }

    public long getStartedAt() {
        return startedAt;
    }

    public String getPrompt() {
        return prompt;
    }

    public String getUserMessageId() {
        return userMessageId;
    }

    public String getAssistantMessageId() {
        return assistantMessageId;
    }
}
