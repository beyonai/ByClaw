package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.SuggestionQuestionVo;
import com.iwhalecloud.byai.state.domain.chat.model.ChatResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import org.apache.commons.lang3.StringUtils;

import java.io.OutputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.Getter;
import lombok.Setter;

/**
 * 聊天流程上下文对象，用于在主流程各步骤间传递和共享数据。 包含请求参数、消息对象、会话信息、异常、计时等。
 */
@Getter
@Setter
public class ChatProcessContext {

    /**
     * 停止会话哨兵事件类型。stopChat 同 pod + HTTP SSE 场景下，向 {@link #gatewayEventQueue}
     * 投递携带该 event_type 的事件，使阻塞在队列上的请求线程退出循环并按正常完成落库。
     */
    public static final String STOP_SENTINEL_EVENT = "__byclaw_stop_sentinel__";

    /** SSE响应输出流 */
    public OutputStream res;

    /** 聊天请求参数 */
    public AssistantChatDto assistantChatDto;

    /** 用户提问消息对象 */
    public ByaiMessageHotDtoDto askMsg;

    /** 系统回复消息对象 */
    public ByaiMessageHotDtoDto resMsg;

    /** 用户消息ID */
    public Long userMessageId;

    /** LLM回复消息ID */
    public Long modelAnswerMessageId;

    public String traceId;

    /** 会话ID */
    public Long sessionId;

    /** 推荐问题异步任务 */
    public SuggestionQuestionVo suggestionQuestion;

    /** 消息上下文（增量流/推理日志等） */
    public MessageContext messageContext;

    /** 请求Python服务的参数 */
    public Map<String, Object> params;

    /** 主流程起始时间 */
    public long startTime;

    /** 首词响应开始时间（Controller入口时间，毫秒） */
    public long firstTextStartTime;

    /** 首词响应结束时间（收到第一个answerDelta的时间，毫秒） */
    public long firstTextEndTime;

    /** 首词响应时长（毫秒），null表示未收到首词或异常 */
    public Float firstTextDuration;

    /** 是否已记录首词响应时间（避免重复记录） */
    public boolean firstTextTimeRecorded = false;

    /**
     * token统计信息，按agentId分组存储 key: agentId (String) value: TokenStats对象，包含startTime, inputTokenCount, outputTokenCount,
     * outputTokenPerSecond
     */
    public Map<Long, TokenStats> tokenStatsMap;

    /** 聊天响应对象 */
    public ChatResponse chatResponse;

    /** 流程中捕获的异常 */
    public Exception exception;

    /**
     * 任务消息index
     */
    public ByaiMessageRelObjDto taskMessageIndex;

    /**
     * 历史消息
     */
    public List<ByaiMessageHotDto> taskHistoryMessages;

    /**
     * 任务id
     */
    public Long taskId;

    public Set<Long> agentIds = new HashSet<>();

    /** 知识库ID集合 */
    public Set<Long> datasetIds = new HashSet<>();

    /**
     * Gateway 模式：请求线程在 handleGatewayMode() 中循环消费此队列，
     * Redis 监听器将收到的每条事件 JSONObject 投入队列，
     * 所有 OutputStream 写操作均在 Tomcat 请求线程中执行，保证 SSE 实时推流。
     * appStreamResponse / error 事件会终止循环。
     */
    public BlockingQueue<JSONObject> gatewayEventQueue;

    /**
     * Gateway 模式出错标志：error 事件已在 handleGatewayMode() 写入前端 OutputStream，
     * storeMessage 应跳过写流只做 DB 持久化，避免重复写出错误响应。
     */
    public boolean gatewayError = false;

    /**
     * 是否仅发送 Gateway/Framework 消息，不重复启动 Redis Stream 监听。
     * 同一个 session 已有运行态时，后续请求使用该模式兼容旧 SSE 行为。
     */
    public boolean sendByFrameworkMsgOnly = false;

    /**
     * 是否继续当前正在运行的 trace。
     * 命中时本次输入只转发给 worker，不作为新的用户消息广播或入库。
     */
    public boolean continueRunningTrace = false;

    /**
     * 是否异步完成响应。WebSocket 场景只负责发送 Gateway 消息，后续 Redis 流由事件路由服务推送和落库。
     */
    public boolean asyncResponse = false;

    /**
     * 消息发往 gateway 的targetAgentType
     */
    public String targetAgentType;

    /**
     * 多泳道请求中允许作为主回答的 targetAgentType 集合。
     */
    public Set<String> targetAgentTypes = new HashSet<>();

    /**
     * 当前聊天入口的传输方式。
     */
    public ChatTransport transport = ChatTransport.HTTP_SSE;

    /**
     * 前端生成的本轮回答关联标识，通常等于 answerMsg.msgId。
     */
    public String clientRequestId;

    /**
     * 当前正在处理的 Redis Stream 事件 ID，用于前端恢复运行中会话时按版本合并快照和实时流。
     */
    public String currentStreamId;

    /**
     * 多智能体泳道请求中，每个 traceId 对应的泳道元数据。
     */
    public Map<String, JSONObject> multiAgentLaneMetadataByTraceId = new HashMap<>();

    /**
     * 多智能体泳道请求中，每个 traceId 独立聚合自己的回答内容。
     */
    public Map<String, MessageContext> multiAgentMessageContextsByTraceId = new HashMap<>();

    /**
     * 多智能体泳道请求中本次请求等待的所有 traceId。
     */
    public Set<String> multiAgentTraceIds = new HashSet<>();

    /**
     * 多智能体泳道请求中已经收到结束事件的 traceId。
     */
    public Set<String> completedMultiAgentTraceIds = new HashSet<>();

    /**
     * 当前请求写入 Redis 运行态标记时使用的所有者 token，用于结束时只清理自己创建的标记。
     */
    public String runningOutputStreamToken;

    /**
     * 当前请求的登录用户信息，用于在 handleGatewayMode() 中获取 userCode
     */
    public LoginInfo loginInfo;

    /**
     * 当前用户ID，用于多端广播时查找用户的所有 WebSocket Channel
     */
    public Long userId;

    /**
     * 发送请求的 WebSocket Channel（HTTP SSE 场景为 null），
     * 多端广播时排除该 Channel 避免重复推送
     */
    public io.netty.channel.Channel senderChannel;

    public ChatProcessContext(OutputStream res, AssistantChatDto assistantChatDto) {
        this.res = res;
        this.resMsg = new ByaiMessageHotDtoDto();
        this.assistantChatDto = assistantChatDto;
        this.tokenStatsMap = new HashMap<>();
        this.suggestionQuestion = new SuggestionQuestionVo();
        this.clientRequestId = assistantChatDto == null ? null : assistantChatDto.getClientRequestId();
    }

    public boolean isWebSocketTransport() {
        return ChatTransport.WEBSOCKET.equals(transport);
    }

    public boolean isCurrentTrace(String receivedTraceId) {
        if (StringUtils.isBlank(receivedTraceId)) {
            return false;
        }
        return receivedTraceId.equals(traceId) || multiAgentTraceIds.contains(receivedTraceId);
    }

    public JSONObject getMultiAgentLaneMetadata(String receivedTraceId) {
        if (StringUtils.isBlank(receivedTraceId)) {
            return null;
        }
        return multiAgentLaneMetadataByTraceId.get(receivedTraceId);
    }

    public MessageContext resolveMessageContext(String receivedTraceId) {
        if (StringUtils.isNotBlank(receivedTraceId)) {
            MessageContext laneContext = multiAgentMessageContextsByTraceId.get(receivedTraceId);
            if (laneContext != null) {
                return laneContext;
            }
        }
        return messageContext;
    }

    public boolean isMultiAgentRequest() {
        return !multiAgentTraceIds.isEmpty();
    }

    public boolean markTraceComplete(String receivedTraceId) {
        if (!isMultiAgentRequest()) {
            return true;
        }
        if (StringUtils.isNotBlank(receivedTraceId) && multiAgentTraceIds.contains(receivedTraceId)) {
            completedMultiAgentTraceIds.add(receivedTraceId);
        }
        return completedMultiAgentTraceIds.containsAll(multiAgentTraceIds);
    }

    public boolean isTargetAgentType(String sourceAgentType) {
        if (StringUtils.isBlank(sourceAgentType)) {
            return true;
        }
        if (!targetAgentTypes.isEmpty()) {
            return targetAgentTypes.contains(sourceAgentType);
        }
        return StringUtils.isBlank(targetAgentType) || sourceAgentType.equals(targetAgentType);
    }

    /**
     * 消息持久化一次性闸门：保证一次对话的 storeMessage / 异常落库只执行一次。
     * <p>
     * 用户停止会话（stopChat）时可能主动触发落库，而 owner pod 的请求线程在
     * gatewayEventQueue.poll 超时或随后收到事件时也会走落库路径，两者竞争同一份累积内容，
     * 通过该闸门去重，避免重复 insert byai_message。
     */
    public final transient AtomicBoolean messagePersisted = new AtomicBoolean(false);

    /**
     * 尝试占用落库闸门。
     *
     * @return true 表示本次调用方抢到落库权，应执行持久化；false 表示已被其他线程落库，应跳过。
     */
    public boolean tryBeginPersist() {
        return messagePersisted.compareAndSet(false, true);
    }
}
