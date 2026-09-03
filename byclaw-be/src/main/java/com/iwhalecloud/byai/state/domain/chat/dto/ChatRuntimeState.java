package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;

import lombok.Getter;
import lombok.Setter;

/**
 * Redis 中保存的运行中会话状态，用于 JVM 重启或 Pod 漂移后的恢复。
 */
@Getter
@Setter
public class ChatRuntimeState {

    public static final String STATUS_RUNNING = "RUNNING";

    public static final String STATUS_HANDOFF_REQUESTED = "HANDOFF_REQUESTED";

    public static final String STATUS_CANCELED = "CANCELED";

    public static final String STATUS_FINISHED = "FINISHED";

    private Long sessionId;

    private String traceId;

    private Boolean concurrentGatewayTurn;

    private Long userMessageId;

    private Long modelAnswerMessageId;

    private Long taskId;

    private Long userId;

    private AssistantChatDto assistantChatDto;

    private ByaiMessageHotDtoDto askMsg;

    private LoginInfo loginInfo;

    private String targetAgentType;

    private String transport;

    private String clientRequestId;

    private String ownerInstanceId;

    private String token;

    private Long startedAt;

    private Long lastHeartbeatAt;

    private Long handoffRequestedAt;

    private String status = STATUS_RUNNING;
}
