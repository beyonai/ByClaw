package com.iwhalecloud.byai.state.domain.message.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.google.common.base.Joiner;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.MessageFactory;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.state.domain.session.dto.AppendMessageDto;
import com.iwhalecloud.byai.state.domain.session.dto.MessageDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.MemoryRuntimeException;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import feign.FeignException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Properties;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.TopicPartition;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.USER_INPUT;

/**
 * <br>
 * <Description of the type></br>
 *
 * @author track
 * @version 1.0
 * @since 1.0
 */
@Service
public class MemoryMessageService {

    private final Logger logger = LoggerFactory.getLogger(getClass());

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private MessageFactory messageFactory;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /** 消息流 Kafka Topic，与 nexusai-message 推送一致 */
    @Value("${nexusai.message.kafka.default-topic:byai-message-stream}")
    private String messageStreamTopic;

    @Value("${spring.kafka.bootstrap-servers:localhost:9092}")
    private String kafkaBootstrapServers;

    @Value("${nexusai.message.kafka.default-partitions:1}")
    private int messageStreamDefaultPartitions;

    /**
     * 保存消息到记忆引擎
     *
     * @param sessionId 会话ID
     * @param usage 消息用途类型
     * @param messageStruct 消息上下文结构
     * @param assistantChatDto 助手聊天数据传输对象
     * @return MessageDto 保存后的消息对象
     */
    public ByaiMessageHotDtoDto save(Long sessionId, Integer usage, MessageContext messageStruct,
        AssistantChatDto assistantChatDto) {
        try {

            // 保存消息
            ByaiMessageHotDtoDto byaiMessageHotDto = this.generateMessage(sessionId, usage, messageStruct,
                assistantChatDto);
            byaiMessageHotService.add(byaiMessageHotDto);

            return byaiMessageHotDto;
        }
        catch (FeignException e) {
            throw MemoryRuntimeException.messageRuntimeException(e);
        }
    }

    /**
     * 生成消息对象
     *
     * @param sessionId 会话ID
     * @param usage 消息用途类型
     * @param messageStruct 消息上下文结构
     * @param assistantChatDto 助手聊天数据传输对象
     * @return MessageDto 生成的消息对象
     */
    public ByaiMessageHotDtoDto generateMessage(Long sessionId, Integer usage, MessageContext messageStruct,
        AssistantChatDto assistantChatDto) {
        ByaiMessageHotDtoDto byaiMessageHotDto = new ByaiMessageHotDtoDto();
        byaiMessageHotDto.setMessageId(messageStruct.getMessageId());
        byaiMessageHotDto.setSessionId(sessionId);
        // 设置完整的最终答案消息框架（整合了完整的消息内容）
        setMessageValueByStruct(byaiMessageHotDto, messageStruct, assistantChatDto, usage);
        byaiMessageHotDto.setResComIds(messageStruct.getResComIds());
        // 增加智能体，聊天消息等标题，头像信息
        if (Objects.equals(ChatUseageEnum.FORWARD_TYPE.getCode(), usage)
            && CollectionUtils.isNotEmpty(messageStruct.getForwardMsgIds())) {
            String metadataStr = Optional.ofNullable(assistantChatDto.getMetadata()).orElse("{}");
            Map<String, Object> metadata = JSONObject.parseObject(metadataStr, Map.class);
            metadata.put("forwardMsgIds", Joiner.on(",").join(messageStruct.getForwardMsgIds()));
            byaiMessageHotDto.setMetadata(JSON.toJSONString(metadata));
        }
        else {
            byaiMessageHotDto.setMetadata(assistantChatDto.getMetadata());
        }
        byaiMessageHotDto.setCreateTime(new Date());
        byaiMessageHotDto.setCreatorId(CurrentUserHolder.getCurrentUserId());
        MessageResourceDto messageResourceDto = new MessageResourceDto();
        // 用户输入的记录用户输入的文件和扩展参数
        if (USER_INPUT.getCode().equals(usage)) {
            messageResourceDto.setFiles(messageStruct.getUploadFiles());
            messageResourceDto.setExtParams(assistantChatDto.getExtParams());
            messageResourceDto.setResourceList(assistantChatDto.getResourceList());
            byaiMessageHotDto.setRelatedResources(JSON.toJSONString(messageResourceDto));
        }
        else {
            // 大模型返回的资源信息
            messageResourceDto.setResources(messageStruct.getChatRelatedResource());
            byaiMessageHotDto.setRelatedResources(JSON.toJSONString(messageResourceDto));
        }
        if (StringUtils.isNotBlank(messageStruct.getCallLogs())) {
            byaiMessageHotDto.setCallLogs(messageStruct.getCallLogs());
        }
        if (CollectionUtils.isNotEmpty(messageStruct.getMentionUserIds())) {
            byaiMessageHotDto.setMentionUserIds(messageStruct.getMentionUserIds());
        }
        if (messageStruct.getMsgStatus() == null) {
            byaiMessageHotDto.setMsgStatus(MsgStatus.FINISH.getCode());
        }
        else {
            byaiMessageHotDto.setMsgStatus(messageStruct.getMsgStatus());
        }
        byaiMessageHotDto.setCreatorName(CurrentUserHolder.getCurrentUserName());
        return byaiMessageHotDto;
    }

    /**
     * 根据消息结构设置消息对象的值
     *
     * @param messageDto 消息数据传输对象
     * @param messageStruct 消息上下文结构
     * @param assistantChatDto 助手聊天数据传输对象
     * @param usage 消息用途类型
     */
    private void setMessageValueByStruct(ByaiMessageHotDto messageDto, MessageContext messageStruct,
        AssistantChatDto assistantChatDto, Integer usage) {
        if (CollectionUtils.isNotEmpty(messageStruct.getAnswerMessageList())) {
            messageDto.setMessageStruct(JSON.toJSONString(messageStruct.getAnswerMessageList()));
        }
        // 整合完整的推理内容，推理可以有多个（带框架的）
        if (CollectionUtils.isNotEmpty(messageStruct.getReasonMessageList())) {
            messageDto.setInferLog(JSON.toJSONString(messageStruct.getReasonMessageList()));
        }
        // 设置完整的最终答案
        messageDto.setMessageContent(messageStruct.returnAnswerText());
        messageDto.setUsage(usage);
        // todo 待前端传
        messageDto.setAccessTerminal(assistantChatDto.getAccessTerminal());
        // todo 待修改
        messageDto.setProjectId(
            Long.parseLong(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID)));
        if (messageStruct.getTaskId() == null) {
            Long taskId = messageFactory.getTaskId();
            messageDto.setTaskId(taskId);
        }
        else {
            messageDto.setTaskId(messageStruct.getTaskId());
        }

    }

    /**
     * 保存消息到记忆引擎
     *
     * @param ctx 本次聊天的上下文内容
     * @param byaiMessageHotDto 任务消息
     * @param messageStruct sse返回后数据
     * @return MessageDto
     */
    public ByaiMessageHotDto updateTaskMessage(ChatProcessContext ctx, ByaiMessageHotDto byaiMessageHotDto,
        MessageContext messageStruct) {
        try {
            // 判断是否重跑和用户反馈
            List<AnswerDelta> messageStructList = Lists.newArrayList();
            List<AnswerDelta> inferLogList = Lists.newArrayList();
            // 处理回答消息
            handleAppendMessage(messageStructList, ctx, byaiMessageHotDto.getMessageStruct(),
                messageStruct.getAnswerMessageList());

            // 处理思考过程消息
            handleAppendMessage(inferLogList, ctx, byaiMessageHotDto.getInferLog(),
                messageStruct.getReasonMessageList());

            byaiMessageHotDto.setMessageStruct(JSON.toJSONString(messageStructList));
            byaiMessageHotDto.setInferLog(JSON.toJSONString(inferLogList));

            // 设置完整的最终答案
            StringBuilder content = new StringBuilder();
            for (AnswerDelta answerDelta : messageStructList) {
                String sseContext = CompletionsUtils.getSseContext(answerDelta);
                if (StringUtils.isNotBlank(sseContext)) {
                    content.append(sseContext);
                }
            }
            byaiMessageHotDto.setMessageContent(content.toString());
            if (StringUtils.isNotBlank(messageStruct.getCallLogs())) {
                byaiMessageHotDto.setCallLogs(messageStruct.getCallLogs());
            }

            byaiMessageHotService.updateSelective(byaiMessageHotDto);
            return byaiMessageHotDto;
        }
        catch (Exception e) {
            throw MemoryRuntimeException.messageRuntimeException(e);
        }
    }

    /**
     * 处理追加消息
     *
     * @param answerDeltaList 补充追加的消息列表
     * @param ctx 本次聊天的上下文
     * @param messageStruct 历史消息
     * @param chatAnswerList 本次聊天产生的消息
     */
    private void handleAppendMessage(List<AnswerDelta> answerDeltaList, ChatProcessContext ctx, String messageStruct,
        List<AnswerDelta> chatAnswerList) {
        AssistantChatDto assistantChatDto = ctx.getAssistantChatDto();
        if (StringUtils.isNotBlank(messageStruct)) {
            List<AnswerDelta> answerDeltas = JSON.parseArray(messageStruct, AnswerDelta.class);
            if (TaskOperateTypeEnum.RERUN.equals(assistantChatDto.getTaskOperateType())) {
                // 过滤掉当前跑的消息
                answerDeltas = answerDeltas.stream()
                    .filter(item -> !assistantChatDto.getTaskStepId().equals(item.getStepId())).toList();
            }
            else if (TaskOperateTypeEnum.UPDATE.equals(assistantChatDto.getTaskOperateType())) {
                // 清空历史
                answerDeltas.clear();
            }

            answerDeltaList.addAll(answerDeltas);
        }
        answerDeltaList.addAll(chatAnswerList);
    }

    /**
     * 追加消息
     *
     * @param appendMessageDto 追加消息数据传输对象
     */
    public void appendMessage(AppendMessageDto appendMessageDto) {
        ByaiMessageHotDto byaiMessageHotDto = new ByaiMessageHotDto();
        byaiMessageHotDto.setMessageId(appendMessageDto.getMessageId());
        byaiMessageHotDto.setMessageContent(appendMessageDto.getContent());
        byaiMessageHotDto.setMessageStruct(appendMessageDto.getMessageStruct());
        byaiMessageHotDto.setInferLog(appendMessageDto.getInferLog());
        byaiMessageHotDto.setComplete(true);
        byaiMessageHotDto.setArchivedAt(new Date());
        // 完成状态
        byaiMessageHotDto.setMsgStatus(0);
        byaiMessageHotService.updateSelective(byaiMessageHotDto);

    }

    /**
     * 消息流式返回：从 Kafka 消费指定 messageId/sessionId 的流并通过 SSE 格式输出 逻辑由原 nexusai-message
     * ByaiMessageStreamSseController#streamMessageSse 迁入，取消 Feign 调用
     *
     * @param messageDto 消息数据传输对象（需含 messageId、sessionId）
     * @return InputStream SSE 格式消息流输入流
     */
    public InputStream messageStream(MessageDto messageDto) {
        Long messageId = messageDto.getMessageId();
        Long sessionId = messageDto.getSessionId();
        if (messageId == null || sessionId == null) {
            throw new IllegalArgumentException(I18nUtil.get("memory.message.service.message.stream.param.required"));
        }

        try {
            PipedOutputStream pos = new PipedOutputStream();
            PipedInputStream pis = new PipedInputStream(pos);

            Thread consumerThread = new Thread(() -> {
                try (OutputStreamWriter writer = new OutputStreamWriter(pos, StandardCharsets.UTF_8)) {
                    streamMessageSseInternal(messageId, sessionId, null, writer);
                }
                catch (Exception e) {
                    logger.error("消息流 SSE 消费异常, messageId={}, sessionId={}", messageId, sessionId, e);
                    try {
                        pos.write(
                            ("data: {\"type\":\"error\",\"message\":\"SSE流异常\"}\n\n").getBytes(StandardCharsets.UTF_8));
                        pos.flush();
                    }
                    catch (IOException ignored) {
                        // ignore
                    }
                }
                finally {
                    try {
                        pos.close();
                    }
                    catch (IOException ignored) {
                        // ignore
                    }
                }
            }, "message-stream-sse-" + messageId);
            consumerThread.setDaemon(true);
            consumerThread.start();

            return pis;
        }
        catch (IOException e) {
            logger.error("创建消息流管道失败", e);
            throw new MemoryRuntimeException(I18nUtil.get("memory.message.service.message.stream.pipe.failed"), e);
        }
    }

    /**
     * 从 Kafka 消费消息流并写入 SSE 格式
     */
    private void streamMessageSseInternal(Long messageId, Long sessionId, Long fromOffset, OutputStreamWriter writer)
        throws IOException {
        Properties props = new Properties();
        props.put("bootstrap.servers", kafkaBootstrapServers);
        props.put("group.id", "sse-message-stream-" + messageId + "-" + sessionId);
        props.put("enable.auto.commit", "false");
        props.put("auto.offset.reset", "earliest");
        props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
        props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

        try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
            int targetPartition = getPartitionForSession(sessionId);
            TopicPartition topicPartition = new TopicPartition(messageStreamTopic, targetPartition);
            consumer.assign(Collections.singletonList(topicPartition));

            long startOffset = determineStartOffset(sessionId, messageId, fromOffset);
            if (startOffset >= 0) {
                consumer.seek(topicPartition, startOffset);
                logger.info("消息流设置起始 offset: messageId={}, sessionId={}, startOffset={}", messageId, sessionId,
                    startOffset);
            }

            logger.info("SSE 流连接：messageId={}, sessionId={}, 分区={}", messageId, sessionId, targetPartition);

            boolean endFlag = false;
            long messagesProcessed = 0;

            while (!endFlag) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(2));
                for (ConsumerRecord<String, String> record : records) {
                    if (isTargetMessage(record, messageId, sessionId)) {
                        boolean isComplete = processAndSendToStream(writer, record, messageId);
                        messagesProcessed++;
                        if (isComplete) {
                            sendEndToStream(writer, messageId, record.offset());
                            endFlag = true;
                            break;
                        }
                    }
                }
            }

            logger.info("SSE 流结束：messageId={}, sessionId={}, 处理消息数={}", messageId, sessionId, messagesProcessed);
        }
    }

    /** 计算 sessionId 对应分区号，与 nexusai-message 生产者一致 */
    private int getPartitionForSession(Long sessionId) {
        String partitionKey = "session_" + sessionId;
        int hash = partitionKey.hashCode();
        return (hash & Integer.MAX_VALUE) % messageStreamDefaultPartitions;
    }

    /** 确定起始 offset，优先 fromOffset，否则从最新 */
    private long determineStartOffset(Long sessionId, Long messageId, Long fromOffset) {
        if (fromOffset != null && fromOffset >= 0) {
            return fromOffset;
        }
        return -1;
    }

    /** 判断是否为目标 messageId、sessionId 的消息 */
    private boolean isTargetMessage(ConsumerRecord<String, String> record, Long messageId, Long sessionId) {
        try {
            String key = record.key();
            if (!("session_" + sessionId).equals(key)) {
                return false;
            }
            String value = record.value();
            return value != null && value.contains("\"messageId\":" + messageId);
        }
        catch (Exception e) {
            logger.warn("验证消息失败: {}", e.getMessage());
            return false;
        }
    }

    /** 解析 Kafka 消息并写入 SSE data 行，返回是否已结束 */
    private boolean processAndSendToStream(OutputStreamWriter writer, ConsumerRecord<String, String> record,
        Long messageId) throws IOException {
        try {
            String value = record.value();
            JSONObject kafkaObj = JSON.parseObject(value);
            Boolean isComplete = kafkaObj.getBoolean("isComplete");
            String content = kafkaObj.getString("messageContent");
            String inferLog = kafkaObj.getString("inferLog");
            String messageStruct = kafkaObj.getString("messageStruct");
            Integer appendIndex = kafkaObj.getInteger("appendIndex");

            JSONObject sseData = new JSONObject();
            sseData.put("type", "content");
            sseData.put("messageId", messageId);
            sseData.put("chunkIndex", appendIndex);
            sseData.put("content", content);
            sseData.put("messageStruct", messageStruct);
            sseData.put("offset", record.offset());
            sseData.put("partition", record.partition());
            sseData.put("timestamp", Instant.now().toString());
            sseData.put("inferLog", inferLog);

            writer.write("data: " + sseData.toJSONString() + "\n\n");
            writer.flush();

            logger.debug("SSE 推送消息块: messageId={}, appendIndex={}, partition={}, offset={}", messageId, appendIndex,
                record.partition(), record.offset());

            return Boolean.TRUE.equals(isComplete);
        }
        catch (Exception e) {
            logger.warn("解析 Kafka 消息失败: {}", record.value(), e);
            writer.write("data: " + record.value() + "\n\n");
            writer.flush();
            return false;
        }
    }

    /** 写入结束事件 */
    private void sendEndToStream(OutputStreamWriter writer, Long messageId, long finalOffset) throws IOException {
        JSONObject endData = new JSONObject();
        endData.put("type", "end");
        endData.put("messageId", messageId);
        endData.put("finalOffset", finalOffset);
        endData.put("completeTime", Instant.now().toString());
        writer.write("data: " + endData.toJSONString() + "\n\n");
        writer.flush();
    }

    /**
     * 获取消息数量和位置信息 逻辑由 nexusai-message ByaiMessageServiceImpl#getMessageCountAndPosition 迁入，取消 Feign 调用，ES 查询在
     * ByaiMessageHotService 中实现
     *
     * @param messageQo 消息查询对象
     * @return Map 包含 totalCount（会话消息总数）、position（可选，指定 messageId 在会话中的 1-based 位置）
     */
    public Map<String, Object> getMessageCountAndPosition(MessageQo messageQo) {
        if (messageQo == null) {
            throw new MemoryRuntimeException(I18nUtil.get("memory.message.service.message.qo.cannot.be.null"));
        }
        Long sessionId = messageQo.getSessionId();
        if (sessionId == null) {
            throw new MemoryRuntimeException(I18nUtil.get("memory.message.service.session.id.cannot.be.null"));
        }

        Map<String, Object> result = new HashMap<>();

        try {
            // 1. 获取会话中的消息总数（查 ES）
            long totalCount = byaiMessageHotService.countBySessionId(sessionId);
            result.put("totalCount", totalCount);

            // 2. 若提供 messageId，计算该消息在会话中的位置（1-based）
            Long messageId = messageQo.getMessageId();
            if (messageId != null) {
                ByaiMessageHotDto targetMessage = byaiMessageHotService.findById(messageId);
                if (targetMessage == null) {
                    throw new MemoryRuntimeException(
                        I18nUtil.get("memory.message.service.message.not.exist", messageId));
                }
                if (!sessionId.equals(targetMessage.getSessionId())) {
                    throw new MemoryRuntimeException(I18nUtil.get("memory.message.service.message.not.belong.session"));
                }
                long position = byaiMessageHotService.countPositionInSession(sessionId, messageId);
                result.put("position", position);
            }
            return result;
        }
        catch (MemoryRuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error("获取消息数量和位置失败, messageQo={}", JSON.toJSONString(messageQo), e);
            throw MemoryRuntimeException.messageRuntimeException(e);
        }
    }
}
