package com.iwhalecloud.byai.state.domain.chat.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import lombok.Getter;
import lombok.Setter;
import org.apache.commons.collections.CollectionUtils;
import com.alibaba.fastjson.JSONObject;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;

/**
 * 消息上下文 用于保存聊天过程中的消息内容、推理过程、流式输出等信息
 */
@Slf4j
@Getter
@Setter
public class MessageContext {

    /**
     * 智能体类型
     */
    private AgentTypeEnum type;

    /**
     * 消息ID
     */
    private Long messageId;

    /**
     * 任务id
     */
    private Long taskId;

    // ============ ES需要存储到message字段如下 ============

    /**
     * 最终答案文本（用于大模型和消息内容）
     */
    private StringBuilder answerText = new StringBuilder();

    /**
     * 结构化消息（临时对象，最后会聚合成answerMessageList）
     */
    private AnswerDelta messageStruct = new AnswerDelta();

    /**
     * 消息结构模板
     */
    private String messageStructTemplate;

    /**
     * 思考过程消息列表
     */
    private List<AnswerDelta> reasonMessageList = Lists.newArrayList();

    /**
     * 回答消息列表
     */
    private List<AnswerDelta> answerMessageList = Lists.newArrayList();

    /**
     * 流式思考过程消息列表（群聊用）
     */
    private List<AnswerDelta> streamReasonMessageList = Lists.newArrayList();

    /**
     * 流式回答消息列表（群聊用）
     */
    private List<AnswerDelta> streamAnswerMessageList = Lists.newArrayList();

    /**
     * 流式回答文本（群聊用）
     */
    private StringBuilder streamAnswerText = new StringBuilder();

    /**
     * 问答上传的文件列表
     */
    private List<MessageFileDto> uploadFiles;

    /**
     * 聊天关联资源列表
     */
    private List<ChatRelatedResource> chatRelatedResource = new ArrayList<>();

    /**
     * 追加索引
     */
    private Integer appendIndex = 0;

    /**
     * 是否完成
     */
    private Boolean complete = false;

    /**
     * 记录任务的调用情况
     */
    private String callLogs;

    /**
     * 提及的用户ID集合
     */
    private Set<Long> mentionUserIds;

    /**
     * 关联资源标识
     */
    private String resComIds;

    /**
     * 消息状态 0:结束 1：追加
     */
    private Integer msgStatus;

    // ============ ES存储字段结束 ============

    // ============ 以下是上下文临时对象 ============

    /**
     * 流式回答消息列表（群聊用）
     */
    private List<StringBuilder> streamAnswerList = Lists.newArrayList();

    /**
     * 流式推理消息列表（群聊用）
     */
    private List<StringBuilder> streamReasonList = Lists.newArrayList();

    /**
     * 推理过程列表
     */
    private List<StringBuilder> reasonList = Lists.newArrayList();

    /**
     * 回答过程列表
     */
    private List<StringBuilder> answerList = Lists.newArrayList();

    /**
     * 转发消息ID集合
     */
    private Set<Long> forwardMsgIds;

    /**
     * 默认构造方法
     */
    public MessageContext() {

    }

    /**
     * 构造方法
     *
     * @param inputType 智能体类型
     * @param messageId 消息ID
     */
    public MessageContext(AgentTypeEnum inputType, Long messageId) {
        this.type = inputType;
        this.messageId = messageId;
    }

    /**
     * 构造方法
     *
     * @param inputType 智能体类型
     * @param messageId 消息ID
     * @param taskId 任务ID
     */
    public MessageContext(AgentTypeEnum inputType, Long messageId, Long taskId) {
        this.type = inputType;
        this.messageId = messageId;
        this.taskId = taskId;
    }

    /**
     * 添加消息相关资源
     *
     * @param input 资源列表
     */
    public void recordChatRelatedResource(List<ChatRelatedResource> input) {
        try {
            chatRelatedResource.addAll(input);
        }
        catch (Exception e) {
            log.error(e.getMessage(), e);
        }
    }

    /**
     * 从增量消息中抽取正文内容并记录到answerText
     *
     * @param text 增量消息文本
     */
    public void recordAnswerText(String text) {
        // 综合问题才会有sseContext
        // chatbi这里sseContext会为null
        // 从增量消息中抽取相应的正文，可以是内容(md或者普通字符串)，或者卡片
        String sseContext = CompletionsUtils.getSseContext(text);
        if (sseContext != null) {
            answerText.append(sseContext);
            // 记录消息骨架,在最终保存的时候，会把骨架中的消息替换为完整的消息
            if (messageStructTemplate == null) {
                messageStructTemplate = text;
            }
        }
    }

    /**
     * 从增量消息中抽取正文内容并记录到streamAnswerText（流式）
     *
     * @param text 增量消息文本
     */
    public void recordStreamAnswerText(String text) {
        // 综合问题才会有sseContext
        // chatbi这里sseContext会为null
        // 从增量消息中抽取相应的正文，可以是内容(md或者普通字符串)，或者卡片
        String sseContext = CompletionsUtils.getSseContext(text);
        if (sseContext != null) {
            streamAnswerText.append(sseContext);
            // 记录消息骨架,在最终保存的时候，会把骨架中的消息替换为完整的消息
            if (messageStructTemplate == null) {
                messageStructTemplate = text;
            }
        }
    }

    /**
     * 记录结构化消息（支持增量拼接）
     *
     * @param text 增量消息文本
     * @param messageList 消息列表
     * @param textList 文本列表
     */
    public void recordStruct(String text, List<AnswerDelta> messageList, List<StringBuilder> textList) {
        AnswerDelta answerDelta = null;
        // 把增量推理消息内容（MessagePart）转换为json格式
        try {
            answerDelta = JSONObject.parseObject(text, AnswerDelta.class);
        }
        catch (Exception e) {
            log.error("思考过程返回数据错误：{}, 数据如下：{}", e.getMessage(), text, e);
        }
        if (answerDelta == null || CollectionUtils.isEmpty(answerDelta.getChoices())) {
            return;
        }
        try {
            // 如果是第一次做增量数据分析，那么记录响应的消息框架
            if (messageList.isEmpty()) {
                // 记录响应的消息框架
                messageList.add(answerDelta);
                // 记录消息内容
                textList.add(new StringBuilder(answerDelta.getChoices().get(0).getDelta().getContent()));
                return;
            }
            // 获取最后一个消息内容
            AnswerDelta lastAnswerDelta = messageList.get(messageList.size() - 1);
            StringBuilder builder = textList.get(textList.size() - 1);
            boolean ifMerge = answerDelta.getContentType().equals(lastAnswerDelta.getContentType());
            if (StringUtils.isNotBlank(answerDelta.getOrderId())) {
                ifMerge = ifMerge && answerDelta.getOrderId().equals(lastAnswerDelta.getOrderId());
            }
            if (ifMerge) {
                // 判断类型是否一致一致则内容拼接
                builder.append(answerDelta.getChoices().get(0).getDelta().getContent());
                lastAnswerDelta.getChoices().get(0).getDelta().setContent(builder.toString());
            }
            else {
                // 判断类型是否一致不一致生成新的对象
                messageList.add(answerDelta);
                textList.add(new StringBuilder(answerDelta.getChoices().get(0).getDelta().getContent()));
            }
        }
        catch (Exception e) {
            log.error("思考过程处理数据错误：{}， 错误数据如下：{}", e.getMessage(), text, e);
        }
    }

    /**
     * 记录推理过程内容
     *
     * @param text 推理文本
     */
    public void recordInferLog(String text) {
        recordStruct(text, reasonMessageList, reasonList);
        recordStruct(text, streamReasonMessageList, streamReasonList);
    }

    /**
     * 记录回答结构
     *
     * @param text 回答文本
     */
    public void recordAnswerStruct(String text) {
        recordStruct(text, answerMessageList, answerList);
        recordStruct(text, streamAnswerMessageList, streamAnswerList);
    }

    /**
     * 记录调用日志
     *
     * @param value 日志内容
     */
    public void recordCallLog(String value) {
        AnswerDelta answerDelta = JSONObject.parseObject(value, AnswerDelta.class);
        callLogs = answerDelta.getChoices().get(0).getDelta().getContent();
    }

    /**
     * 返回答案文本内容
     *
     * @return 答案文本
     */
    public String returnAnswerText() {
        return answerText.toString();
    }

    /**
     * 返回流式答案文本内容
     *
     * @return 流式答案文本
     */
    public String returnStreamAnswerText() {
        return streamAnswerText.toString();
    }

}
