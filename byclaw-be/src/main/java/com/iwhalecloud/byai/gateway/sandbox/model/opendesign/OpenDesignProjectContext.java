package com.iwhalecloud.byai.gateway.sandbox.model.opendesign;

public class OpenDesignProjectContext {

    private final String projectId;
    private final String conversationId;
    private final boolean projectExists;

    public OpenDesignProjectContext(String projectId, String conversationId, boolean projectExists) {
        this.projectId = projectId;
        this.conversationId = conversationId;
        this.projectExists = projectExists;
    }

    public String getProjectId() {
        return projectId;
    }

    public String getConversationId() {
        return conversationId;
    }

    public boolean isProjectExists() {
        return projectExists;
    }
}
