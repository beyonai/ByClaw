package com.iwhalecloud.byai.gateway.sandbox.model.opendesign;

import java.util.Collections;
import java.util.List;

public class OpenDesignQueryParams {

    private String projectId;
    private String conversationId;
    private String userCode;
    private String daemonBaseUrl;
    private String webBaseUrl;
    private String agentId;
    private String prompt;
    private String chatInputValue;
    private String currentPrompt;
    private String userGoal;
    private String projectName;
    private String conversationTitle;
    private String skillId;
    private String designSystemId;
    private String clientRequestId;
    private String userMessageId;
    private String assistantMessageId;
    private List<String> attachments = Collections.emptyList();
    private List<String> commentAttachments = Collections.emptyList();
    private List<String> skillIds = Collections.emptyList();

    public String getProjectId() {
        return projectId;
    }

    public void setProjectId(String projectId) {
        this.projectId = projectId;
    }

    public String getConversationId() {
        return conversationId;
    }

    public void setConversationId(String conversationId) {
        this.conversationId = conversationId;
    }

    public String getUserCode() {
        return userCode;
    }

    public void setUserCode(String userCode) {
        this.userCode = userCode;
    }

    public String getDaemonBaseUrl() {
        return daemonBaseUrl;
    }

    public void setDaemonBaseUrl(String daemonBaseUrl) {
        this.daemonBaseUrl = daemonBaseUrl;
    }

    public String getWebBaseUrl() {
        return webBaseUrl;
    }

    public void setWebBaseUrl(String webBaseUrl) {
        this.webBaseUrl = webBaseUrl;
    }

    public String getAgentId() {
        return agentId;
    }

    public void setAgentId(String agentId) {
        this.agentId = agentId;
    }

    public String getPrompt() {
        return prompt;
    }

    public void setPrompt(String prompt) {
        this.prompt = prompt;
    }

    public String getChatInputValue() {
        return chatInputValue;
    }

    public void setChatInputValue(String chatInputValue) {
        this.chatInputValue = chatInputValue;
    }

    public String getCurrentPrompt() {
        return currentPrompt;
    }

    public void setCurrentPrompt(String currentPrompt) {
        this.currentPrompt = currentPrompt;
    }

    public String getUserGoal() {
        return userGoal;
    }

    public void setUserGoal(String userGoal) {
        this.userGoal = userGoal;
    }

    public String getProjectName() {
        return projectName;
    }

    public void setProjectName(String projectName) {
        this.projectName = projectName;
    }

    public String getConversationTitle() {
        return conversationTitle;
    }

    public void setConversationTitle(String conversationTitle) {
        this.conversationTitle = conversationTitle;
    }

    public String getSkillId() {
        return skillId;
    }

    public void setSkillId(String skillId) {
        this.skillId = skillId;
    }

    public String getDesignSystemId() {
        return designSystemId;
    }

    public void setDesignSystemId(String designSystemId) {
        this.designSystemId = designSystemId;
    }

    public String getClientRequestId() {
        return clientRequestId;
    }

    public void setClientRequestId(String clientRequestId) {
        this.clientRequestId = clientRequestId;
    }

    public String getUserMessageId() {
        return userMessageId;
    }

    public void setUserMessageId(String userMessageId) {
        this.userMessageId = userMessageId;
    }

    public String getAssistantMessageId() {
        return assistantMessageId;
    }

    public void setAssistantMessageId(String assistantMessageId) {
        this.assistantMessageId = assistantMessageId;
    }

    public List<String> getAttachments() {
        return attachments;
    }

    public void setAttachments(List<String> attachments) {
        this.attachments = attachments;
    }

    public List<String> getCommentAttachments() {
        return commentAttachments;
    }

    public void setCommentAttachments(List<String> commentAttachments) {
        this.commentAttachments = commentAttachments;
    }

    public List<String> getSkillIds() {
        return skillIds;
    }

    public void setSkillIds(List<String> skillIds) {
        this.skillIds = skillIds;
    }
}
