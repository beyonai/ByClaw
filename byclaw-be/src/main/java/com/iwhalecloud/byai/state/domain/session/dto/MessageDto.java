package com.iwhalecloud.byai.state.domain.session.dto;

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


import java.io.Serial;
import java.io.Serializable;
import java.util.List;
import java.util.Set;

import lombok.Data;
import lombok.ToString;

/**
 * 消息实体类
 * */
@Data
@ToString
public class MessageDto implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

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
     * 1：用户输入，2：系统回答，3：系统追问 4：转发
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

    Set<Long> mentionUserIds;


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
     * 头像URL
     */
    private String avatar;

    /**
     * 关联ID
     */
    private String resComIds;

    /**
     * 消息是否流式状态  0是已经完成 1是正在流式返回
     */
    private Integer msgStatus;


    /**
     * 搜索相关性分数
     */
    private Float score;

    private String creatorName;

    /**
     * 转发消息列表
     */
    private List<MessageDto> forwardMsgList;

    //是否全量更新消息
    private Boolean isAllUpdate = false;


    private List<String> collectIds;


}
