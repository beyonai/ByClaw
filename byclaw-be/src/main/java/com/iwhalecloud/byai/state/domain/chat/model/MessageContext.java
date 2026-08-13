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

    private static final String THINK_STATUS_TITLE_CONTENT_TYPE = "3009";

    private static final String TOOL_CALL_CONTENT_TYPE = "3015";

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

    /** Global segment cursor shared by inferLog and messageStruct. */
    private long nextSegmentSeq = 1L;

    private String lastSegmentEventType;

    private String lastSegmentContentType;

    private String lastSegmentOrderId;

    private Long lastSegmentSeq;

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
        recordStruct(text, messageList, textList, null, false);
    }

    private synchronized AnswerDelta recordStruct(String text, List<AnswerDelta> messageList,
        List<StringBuilder> textList,
        String eventType, boolean assignGlobalSeq) {
        AnswerDelta answerDelta = null;
        // 把增量推理消息内容（MessagePart）转换为json格式
        try {
            answerDelta = JSONObject.parseObject(text, AnswerDelta.class);
        }
        catch (Exception e) {
            log.error("思考过程返回数据错误：{}, 数据如下：{}", e.getMessage(), text, e);
        }
        if (answerDelta == null || CollectionUtils.isEmpty(answerDelta.getChoices())) {
            return null;
        }
        answerDelta.setEventType(eventType);
        try {
            AnswerDelta updatedSegment = updateExistingSegment(messageList, textList, answerDelta);
            if (updatedSegment != null) {
                return updatedSegment;
            }
            // 如果是第一次做增量数据分析，那么记录响应的消息框架
            if (messageList.isEmpty()) {
                if (assignGlobalSeq) {
                    assignSegmentSeq(answerDelta, eventType);
                }
                // 记录响应的消息框架
                messageList.add(answerDelta);
                // 记录消息内容
                textList.add(new StringBuilder(answerDelta.getChoices().get(0).getDelta().getContent()));
                return answerDelta;
            }
            // Snapshots persist the segment arrays but not the transient builders.
            // Recreate missing builders before appending resumed deltas.
            while (textList.size() < messageList.size()) {
                AnswerDelta item = messageList.get(textList.size());
                String content = item.getChoices().get(0).getDelta().getContent();
                textList.add(new StringBuilder(content == null ? "" : content));
            }
            // 获取最后一个消息内容
            AnswerDelta lastAnswerDelta = messageList.get(messageList.size() - 1);
            StringBuilder builder = textList.get(textList.size() - 1);
            boolean ifMerge = StringUtils.equals(answerDelta.getContentType(), lastAnswerDelta.getContentType())
                && StringUtils.equals(answerDelta.getEventType(), lastAnswerDelta.getEventType())
                && StringUtils.equals(answerDelta.getOrderId(), lastAnswerDelta.getOrderId());
            if (assignGlobalSeq) {
                ifMerge = ifMerge
                    && StringUtils.equals(eventType, lastSegmentEventType)
                    && StringUtils.equals(answerDelta.getContentType(), lastSegmentContentType)
                    && StringUtils.equals(answerDelta.getOrderId(), lastSegmentOrderId)
                    && lastSegmentSeq != null
                    && lastSegmentSeq.equals(lastAnswerDelta.getSeq());
            }
            if (assignGlobalSeq && ifMerge) {
                answerDelta.setSeq(lastAnswerDelta.getSeq());
            }
            if (ifMerge) {
                // 判断类型是否一致一致则内容拼接
                builder.append(answerDelta.getChoices().get(0).getDelta().getContent());
                lastAnswerDelta.getChoices().get(0).getDelta().setContent(builder.toString());
            }
            else {
                if (assignGlobalSeq) {
                    assignSegmentSeq(answerDelta, eventType);
                }
                // 判断类型是否一致不一致生成新的对象
                messageList.add(answerDelta);
                String content = answerDelta.getChoices().get(0).getDelta().getContent();
                if (content != null) {
                    textList.add(new StringBuilder(content));
                }
            }
            return ifMerge ? lastAnswerDelta : answerDelta;
        }
        catch (Exception e) {
            log.error("思考过程处理数据错误：{}， 错误数据如下：{}", e.getMessage(), text, e);
            return null;
        }
    }

    private AnswerDelta updateExistingSegment(List<AnswerDelta> messageList, List<StringBuilder> textList,
        AnswerDelta incoming) {
        if (!supportsInPlaceUpdate(incoming.getContentType()) || StringUtils.isBlank(incoming.getOrderId())) {
            return null;
        }
        for (int i = 0; i < messageList.size(); i++) {
            AnswerDelta existing = messageList.get(i);
            if (!StringUtils.equals(existing.getContentType(), incoming.getContentType())
                || !StringUtils.equals(existing.getOrderId(), incoming.getOrderId())) {
                continue;
            }
            String mergedContent = mergeSegmentContent(existing.getContentType(), extractContent(existing),
                extractContent(incoming));
            existing.getChoices().get(0).getDelta().setContent(mergedContent);
            existing.setStatus(incoming.getStatus());
            while (textList.size() <= i) {
                textList.add(new StringBuilder());
            }
            textList.set(i, new StringBuilder(mergedContent));
            return existing;
        }
        return null;
    }

    private boolean supportsInPlaceUpdate(String contentType) {
        return TOOL_CALL_CONTENT_TYPE.equals(contentType) || THINK_STATUS_TITLE_CONTENT_TYPE.equals(contentType);
    }

    private String mergeSegmentContent(String contentType, String existingContent, String incomingContent) {
        if (THINK_STATUS_TITLE_CONTENT_TYPE.equals(contentType)) {
            return incomingContent;
        }
        try {
            JSONObject existing = JSONObject.parseObject(existingContent);
            JSONObject incoming = JSONObject.parseObject(incomingContent);
            existing.putAll(incoming);
            return existing.toJSONString();
        }
        catch (Exception e) {
            log.warn("状态型消息增量内容无法合并，保留最新内容, contentType={}", contentType, e);
            return incomingContent;
        }
    }

    private String extractContent(AnswerDelta answerDelta) {
        return answerDelta.getChoices().get(0).getDelta().getContent();
    }

    /**
     * 记录推理过程内容
     *
     * @param text 推理文本
     */
    public synchronized String recordInferLog(String text) {
        AnswerDelta segment = recordStruct(text, reasonMessageList, reasonList, "reasoningLogDelta", true);
        recordStruct(text, streamReasonMessageList, streamReasonList, "reasoningLogDelta", false);
        return withSegmentMetadata(text, segment, "reasoningLogDelta");
    }

    /**
     * 记录回答结构
     *
     * @param text 回答文本
     */
    public synchronized String recordAnswerStruct(String text) {
        AnswerDelta segment = recordStruct(text, answerMessageList, answerList, "answerDelta", true);
        recordStruct(text, streamAnswerMessageList, streamAnswerList, "answerDelta", false);
        return withSegmentMetadata(text, segment, "answerDelta");
    }

    private void assignSegmentSeq(AnswerDelta answerDelta, String eventType) {
        long seq = nextSegmentSeq++;
        answerDelta.setSeq(seq);
        lastSegmentSeq = seq;
        lastSegmentEventType = eventType;
        lastSegmentContentType = answerDelta.getContentType();
        lastSegmentOrderId = answerDelta.getOrderId();
    }

    /** Restores the cross-channel cursor after loading persisted arrays. */
    public void restoreSegmentCursor() {
        restoreSegmentCursor(reasonMessageList, answerMessageList);
    }

    /** Initializes the cursor from existing persisted segments before an append or rerun starts. */
    public void restoreSegmentCursor(List<AnswerDelta> existingReasonMessages,
        List<AnswerDelta> existingAnswerMessages) {
        AnswerDelta latest = null;
        for (AnswerDelta item : existingReasonMessages) {
            if (item.getSeq() != null && (latest == null || item.getSeq() > latest.getSeq())) {
                latest = item;
            }
        }
        for (AnswerDelta item : existingAnswerMessages) {
            if (item.getSeq() != null && (latest == null || item.getSeq() > latest.getSeq())) {
                latest = item;
            }
        }
        if (latest == null || latest.getSeq() == null) {
            return;
        }
        nextSegmentSeq = latest.getSeq() + 1;
        lastSegmentSeq = latest.getSeq();
        lastSegmentEventType = latest.getEventType();
        lastSegmentContentType = latest.getContentType();
        lastSegmentOrderId = latest.getOrderId();
    }

    private String withSegmentMetadata(String text, AnswerDelta segment, String eventType) {
        try {
            JSONObject payload = JSONObject.parseObject(text);
            if (segment != null) {
                payload.put("seq", segment.getSeq());
                payload.put("eventType", eventType);
                // The stream marker is emitted with the first visible delta so clients can
                // select the ordered renderer before the final message is persisted.
                payload.put("messageRenderVersion", "v2");
            }
            return payload.toJSONString();
        }
        catch (Exception e) {
            return text;
        }
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
