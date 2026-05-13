package com.iwhalecloud.byai.state.common.dto;

/**
 * <br>
 * <Description of the type></br>
 *
 * @author track
 * @version 1.0
 * @taskId 1.0
 * @createDate 2025/4/2
 * @see com.ztesoft.knowledge.dto
 * @since 1.0
 */


import java.util.List;

/**
 * 消息实体类
 * */
public class MessageDto {

    /**
     * 消息id
     * */
    Long messageId;

    /**
     * 消息内容
     * */
    String messageContent;


    /**
     * 消息结构体
     * */
    String messageStruct;

    /**
     * 消息用途
     * 1：用户输入，2：系统回答，3：系统追问
     * */
    Integer usage;


    /**
     *消息引用来源
     * -- 消息引用具体的消息标识
     * */
    Long messageRef;

    /**
     * 消息推理日志
     * */
    String inferLog;

    /**
     * 所属日期
     * 用于冷热数据，按天分区
     * */
    String belongDate;

    /**
     * 消息创建时间
     * */
    String createTime;

    /**
     * 消息创建人id
     * */
    Long creatorId;

    /**
     * 消息会话id
     * */
    Long sessionId;

    /**
     * 消息数据标签
     * */
    String metadata;

    /**
     * 消息关联资源
     * */
    String relatedResources;

    /**
     * 系统日志？？
     * */
    String callLogs;


    /**
     * 消息所属企业id
     */
    Long enterpriseId;


    /**
     * 空间id
     */
    Long projectId;

    /**
     * 消息来源端
     */
    String accessTerminal;

    /**
     * 用户提问消息的requestID
     */
    Long taskId;

    Long agentId;

    /**
     * 对象类型
     */
    String objType;

    /**
     * 对象id
     */
    Long objId;

    /**
     * 消息向量
     */
    List<Double> messageContentVector;

    /**
     * 提问消息标签
     */
    String contentTags;


    //关联资源标识
    private String resComIds;

    public String getContentTags() {
        return contentTags;
    }

    public void setContentTags(String contentTags) {
        this.contentTags = contentTags;
    }

    public List<Double> getMessageContentVector() {
        return messageContentVector;
    }

    public void setMessageContentVector(List<Double> messageContentVector) {
        this.messageContentVector = messageContentVector;
    }

    public String getObjType() {
        return objType;
    }

    public void setObjType(String objType) {
        this.objType = objType;
    }

    public Long getObjId() {
        return objId;
    }

    public void setObjId(Long objId) {
        this.objId = objId;
    }

    public List<String> getRelObjs() {
        return relObjs;
    }

    public void setRelObjs(List<String> relObjs) {
        this.relObjs = relObjs;
    }

    /**
     * 消息的关联对象
     * 回复对象：SU_超级助理ID，AGE_数字员工ID
     * 引用文档库：DOC_文档库Id    (企业检索，如果没有关联文档，存储DOC_NULL)
     */
    private List<String> relObjs;


    /**
     * 消息角色
     *  agent-user、assitant-user 、agent-assitant、 user-agent、user-assitant、assitant-agent
     * */
    private String role;


    /**
     * 搜索相关性分数
     */
    private Float score;

    public Float getScore() {
        return score;
    }

    public void setScore(Float score) {
        this.score = score;
    }

    public Long getProjectId() {
        return projectId;
    }

    public void setProjectId(Long projectId) {
        this.projectId = projectId;
    }

    public String getAccessTerminal() {
        return accessTerminal;
    }

    public void setAccessTerminal(String accessTerminal) {
        this.accessTerminal = accessTerminal;
    }

    public Long getTaskId() {
        return taskId;
    }

    public void setTaskId(Long taskId) {
        this.taskId = taskId;
    }


    /**
     * 头像URL
     */
    private String avatar;

    public String getAvatar() {
        return avatar;
    }

    public void setAvatar(String avatar) {
        this.avatar = avatar;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public Long getEnterpriseId() {
        return enterpriseId;
    }

    public void setEnterpriseId(Long enterpriseId) {
        this.enterpriseId = enterpriseId;
    }

    public Long getMessageId() {
        return messageId;
    }

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }

    public String getMessageContent() {
        return messageContent;
    }

    public void setMessageContent(String messageContent) {
        this.messageContent = messageContent;
    }

    public String getMessageStruct() {
        return messageStruct;
    }

    public void setMessageStruct(String messageStruct) {
        this.messageStruct = messageStruct;
    }

    public Long getMessageRef() {
        return messageRef;
    }

    public void setMessageRef(Long messageRef) {
        this.messageRef = messageRef;
    }

    public String getBelongDate() {
        return belongDate;
    }

    public void setBelongDate(String belongDate) {
        this.belongDate = belongDate;
    }

    public String getCreateTime() {
        return createTime;
    }

    public void setCreateTime(String createTime) {
        this.createTime = createTime;
    }

    public Long getCreatorId() {
        return creatorId;
    }

    public void setCreatorId(Long creatorId) {
        this.creatorId = creatorId;
    }

    public Long getSessionId() {
        return sessionId;
    }

    public void setSessionId(Long sessionId) {
        this.sessionId = sessionId;
    }

    public Integer getUsage() {
        return usage;
    }

    public void setUsage(Integer usage) {
        this.usage = usage;
    }

    public String getInferLog() {
        return inferLog;
    }

    public void setInferLog(String inferLog) {
        this.inferLog = inferLog;
    }

    public String getMetadata() {
        return metadata;
    }

    public void setMetadata(String metadata) {
        this.metadata = metadata;
    }

    public String getRelatedResources() {
        return relatedResources;
    }

    public void setRelatedResources(String relatedResources) {
        this.relatedResources = relatedResources;
    }

    public String getCallLogs() {
        return callLogs;
    }

    public void setCallLogs(String callLogs) {
        this.callLogs = callLogs;
    }

    public Long getAgentId() {
        return agentId;
    }

    public void setAgentId(Long agentId) {
        this.agentId = agentId;
    }

    public String getResComIds() {
        return resComIds;
    }

    public void setResComIds(String resComIds) {
        this.resComIds = resComIds;
    }

    @Override
    public String toString() {
        return "MessageDto{" +
                "messageId=" + messageId +
                ", messageContent='" + messageContent + '\'' +
                ", messageStruct='" + messageStruct + '\'' +
                ", usage=" + usage +
                ", messageRef=" + messageRef +
                ", inferLog='" + inferLog + '\'' +
                ", belongDate='" + belongDate + '\'' +
                ", createTime='" + createTime + '\'' +
                ", creatorId=" + creatorId +
                ", sessionId=" + sessionId +
                ", metadata='" + metadata + '\'' +
                ", relatedResources='" + relatedResources + '\'' +
                ", callLogs='" + callLogs + '\'' +
                ", enterpriseId=" + enterpriseId +
                ", projectId=" + projectId +
                ", accessTerminal='" + accessTerminal + '\'' +
                ", taskId=" + taskId +
                ", relObjs='" + relObjs + '\'' +
                ", role='" + role + '\'' +
                '}';
    }
}
