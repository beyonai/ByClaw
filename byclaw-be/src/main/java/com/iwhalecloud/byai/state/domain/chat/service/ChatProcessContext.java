package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.SuggestionQuestionVo;
import com.iwhalecloud.byai.state.domain.chat.model.ChatResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import lombok.Getter;
import lombok.Setter;

/**
 * 聊天流程上下文对象，用于在主流程各步骤间传递和共享数据。 包含请求参数、消息对象、会话信息、异常、计时等。
 */
@Getter
@Setter
public class ChatProcessContext {
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
    }
}