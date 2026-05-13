package com.iwhalecloud.byai.state.domain.chat.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.gateway.route.RouteService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.model.ChatInitializationDto;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.state.application.service.session.SessionApplicationService;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.ChatResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.men.enums.SystemCodeEnum;
import com.iwhalecloud.byai.state.domain.men.enums.TaskTypeEnum;
import com.iwhalecloud.byai.state.domain.men.service.MenTaskService;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.log.exception.PythonRuntimeException;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.SYSTEM_RESPONSE;
import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.USER_INPUT;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ScriptService extends AbstractChatProcess {

    private static final Logger logger = LoggerFactory.getLogger(ScriptService.class);


    /**
     * 日期格式
     */
    private static final String date_format = "yyyy-MM-dd HH:mm:ss";

    @Autowired
    private SessionApplicationService sessionApplicationService;

    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private ParamService paramService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private MessageFactory messageFactory;

    @Autowired
    private MemoryMessageService memoryMessageService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private MenTaskService menTaskService;

    @Autowired
    private SessionMemberService sessionMemberService;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;

    @Autowired
    private RouteService routeService;

    /**
     * 参数准备：生成消息ID、组装请求参数、初始化上下文等。
     */
    @Override
    public void prepareParams(ChatProcessContext ctx) {
        // 前端有传就使用前端，没有则在马上生成一个session
        ctx.sessionId = ctx.assistantChatDto.getSessionId();

        // 设置多端广播所需的用户标识和发送端 Channel
        ctx.userId = CurrentUserHolder.getCurrentUserId();
        ctx.senderChannel = ctx.assistantChatDto.getSenderChannel();

        // 判断是否更新任务
        if (TaskOperateTypeEnum.UPDATE.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.RERUN.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.FEEDBACK.equals(ctx.assistantChatDto.getTaskOperateType())) {
            // 获取到生成任务的问题
            ctx.taskHistoryMessages = messageFactory.generateUpdateTaskHistory(ctx);
            ctx.userMessageId = ctx.taskHistoryMessages.get(0).getMessageId();
            ctx.taskId = ctx.taskHistoryMessages.get(0).getTaskId();
        }
        else if (TaskOperateTypeEnum.EXECUTE.equals(ctx.assistantChatDto.getTaskOperateType())) {
            ctx.taskHistoryMessages = messageFactory.generateUpdateTaskHistory(ctx);
            // 更新状态 TODO 不应该在这里更新
            messageFactory.updateTaskState(ctx.taskHistoryMessages.get(1));
            ctx.userMessageId = sequenceService.nextVal();
            ctx.taskId = ctx.taskHistoryMessages.get(0).getTaskId();
            // 规划任务执行，先生成一个task父任务,卡片资源id前端封装在参数列表给到后端入库
            addMenTask(ctx);
        }
        else {
            ctx.userMessageId = sequenceService.nextVal();
            // 如果是待办列表点击进来使用的时候使用待办的先，不是就生成一个
            ctx.taskId = Optional.ofNullable(ctx.assistantChatDto).map(AssistantChatDto::getExtParams)
                .filter(params -> params.containsKey("beyondTaskId"))
                .map(params -> MapParamUtil.getLongValue(params, "beyondTaskId")).orElseGet(sequenceService::nextVal);
            // ctx.taskId = sequenceService.nextVal();
        }
        // 只有Netty中才会提前生成消息
        if (TaskOperateTypeEnum.EXECUTE.equals(ctx.assistantChatDto.getTaskOperateType())) {
            ctx.modelAnswerMessageId = sequenceService.nextVal();
        }
        else {
            ctx.modelAnswerMessageId = ctx.assistantChatDto.getLlmMessageId() == null ? sequenceService.nextVal()
                : ctx.assistantChatDto.getLlmMessageId();
        }

        if (TaskOperateTypeEnum.UPDATE.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.RERUN.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.FEEDBACK.equals(ctx.assistantChatDto.getTaskOperateType())) {
            ByaiMessageHotDtoDto askMsg = new ByaiMessageHotDtoDto();
            BeanUtils.copyProperties(ctx.taskHistoryMessages.get(0), askMsg);
            ctx.setAskMsg(askMsg);
        }
        else {
            ctx.askMsg = messageFactory.generateAskMessage(ctx.sessionId, ctx.assistantChatDto.getChatContent(),
                ctx.userMessageId);
        }

        // 多端广播：将用户发送的消息推送到用户的其他设备
        broadcastUserMessage(ctx);

        // 初始化一条前端的信息
        initEvent(ctx);

        // 多端广播：将 initialization 事件推送到用户的其他设备
        broadcastInitEvent(ctx);

        // 将用户聊天内容存储到message表中
        saveUserContent(ctx);

        ctx.messageContext = new MessageContext(AgentTypeEnum.getNameCode(ctx.assistantChatDto.getAgentType()),
            ctx.modelAnswerMessageId, ctx.taskId);

        // 请求python参数
        ctx.params = paramService.getParams(ctx);
    }

    /**
     * 保存用户消息
     *
     * @param ctx
     */
    private void saveUserContent(ChatProcessContext ctx) {
        if (TaskOperateTypeEnum.UPDATE.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.RERUN.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.FEEDBACK.equals(ctx.assistantChatDto.getTaskOperateType())) {
            return;
        }
        MessageContext userContext = new MessageContext(AgentTypeEnum.AGENT, ctx.userMessageId);
        userContext.setUploadFiles(ctx.assistantChatDto.getFiles());
        userContext.setAnswerText(new StringBuilder(ctx.assistantChatDto.getChatContent()));
        // userContext.setAnswerText(dealContent(ctx.assistantChatDto));
        userContext.setTaskId(ctx.taskId);
        memoryMessageService.save(ctx.sessionId, USER_INPUT.getCode(), userContext, ctx.assistantChatDto);
    }

    /**
     * 多端广播：将用户发送的消息推送到用户的其他设备
     */
    private void broadcastUserMessage(ChatProcessContext ctx) {
        try {
            if (TaskOperateTypeEnum.UPDATE.equals(ctx.assistantChatDto.getTaskOperateType())
                || TaskOperateTypeEnum.RERUN.equals(ctx.assistantChatDto.getTaskOperateType())
                || TaskOperateTypeEnum.FEEDBACK.equals(ctx.assistantChatDto.getTaskOperateType())) {
                return;
            }
            JSONObject userMsg = new JSONObject();
            userMsg.put("messageId", ctx.userMessageId);
            userMsg.put("sessionId", ctx.sessionId);
            userMsg.put("chatContent", ctx.assistantChatDto.getChatContent());
            userMsg.put("metadata", ctx.assistantChatDto.getMetadata());
            multiDeviceBroadcastService.broadcastToUserDevices(ctx.userId, ctx.sessionId, "userMessage",
                userMsg.toJSONString(), ctx.senderChannel);
        }
        catch (Exception e) {
            log.warn("多端广播 userMessage 事件异常, sessionId: {}", ctx.sessionId, e);
        }
    }

    /**
     * 处理Python SSE流：请求Python服务，处理流式响应，增量写入客户端。 原有逻辑保持不变；Gateway 异步模式走 handleGatewayMode()。
     */
    @Override
    public void handlePythonSse(ChatProcessContext ctx) throws Exception {
        pythonSseService.handlePythonSse(ctx);
    }

    /**
     * Gateway 模式：通过 Gateway SDK 发送消息后，请求线程在本方法中循环消费事件队列， 将每个 answerDelta 等增量事件即时写入 OutputStream，实现 SSE 实时推流。
     * <p>
     * 核心思路：所有 OutputStream 写操作都在 Tomcat 请求线程（http-nio-*）上执行， 避免非请求线程写流时 Tomcat NIO 不能实时 flush 到 TCP socket 的问题。 Redis
     * 监听器只负责将事件 JSONObject 投入 gatewayEventQueue，本方法消费队列并写流。 收到 appStreamResponse 或 error 事件后退出循环，由 execute() 继续调用
     * storeMessage / afterProcess，最终由 cleanupResources 关闭流。
     */
    @Override
    protected void handleGatewayMode(ChatProcessContext ctx) throws Exception {
        routeService.route(ctx);
    }

    /**
     * 消息存储：将最终消息、索引、推荐问题等存储到数据库或缓存。
     */
    @Override
    public void storeMessage(ChatProcessContext ctx) {
        // Netty群聊中使用保存消息路径
        if (ctx.gatewayError) {
            // Gateway error 事件已由 Redis 监听器写入前端，此处仅持久化消息，不再写流
            resolveMemory(ctx, ctx.assistantChatDto, ctx.sessionId, ctx.messageContext, ctx.resMsg);
        }
        else {
            // 原始路径：持久化 + 向前端写 appStreamResponse
            ctx.chatResponse = resolveMemory(ctx, ctx.assistantChatDto, ctx.sessionId, ctx.messageContext, ctx.resMsg);
            CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.appStreamResponse,
                JSON.toJSONString(ctx.chatResponse), ctx.sessionId);

            // 多端广播：将最终响应推送到用户的其他设备
            broadcastAppStreamResponse(ctx);
        }
    }

    /**
     * 初始化事件 1.用户消息id 2.大模型消息Id
     *
     * @param ctx
     */
    private void initEvent(ChatProcessContext ctx) {
        ChatInitializationDto chatInitializationDto = new ChatInitializationDto();

        Map<String, Object> metadata;
        AssistantChatDto assistantChatDto = ctx.assistantChatDto;
        metadata = getMetadataByassistantChatDto(assistantChatDto);
        assistantChatDto.setMetadata(JSONObject.toJSONString(metadata));
        chatInitializationDto.setMetadata(JSONObject.toJSONString(metadata));
        chatInitializationDto.setMessageId(ctx.modelAnswerMessageId);
        chatInitializationDto.setQueryMessageId(ctx.userMessageId);
        CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.initialization,
            JSON.toJSONString(chatInitializationDto));
    }

    /**
     * 多端广播：将 initialization 事件推送到用户的其他设备
     */
    private void broadcastInitEvent(ChatProcessContext ctx) {
        try {
            ChatInitializationDto dto = new ChatInitializationDto();
            dto.setMessageId(ctx.modelAnswerMessageId);
            dto.setQueryMessageId(ctx.userMessageId);
            dto.setMetadata(ctx.assistantChatDto.getMetadata());
            multiDeviceBroadcastService.broadcastToUserDevices(ctx.userId, ctx.sessionId,
                SseResponseEventEnum.initialization, JSON.toJSONString(dto), ctx.senderChannel);
        }
        catch (Exception e) {
            log.warn("多端广播 initialization 事件异常, sessionId: {}", ctx.sessionId, e);
        }
    }

    public Map<String, Object> getMetadataByassistantChatDto(AssistantChatDto assistantChatDto) {
        Map<String, Object> metadata = new HashMap<>();
        String agentId = Optional.ofNullable(assistantChatDto.getAgentId()).map(Object::toString).orElse(null);
        StringBuilder stringBuilder = new StringBuilder();
        Long userId = CurrentUserHolder.getCurrentUserId();
        // 构建角色标签：agent-agentId-userId
        stringBuilder.append(Constants.MSG_AGENT).append(agentId).append(Constants.MSG_SPLICE)
            .append(String.valueOf(userId));
        metadata.put(Constants.MSG_ROLE, stringBuilder.toString());
        metadata.put("agentId", agentId);
        // 放在外面，一定会写的
        metadata.put("mode", assistantChatDto.getMode());
        // 增加智能体，聊天消息等标题，头像信息
        try {
            List<ResourceVo> resourceList = assistantChatDto.getResourceList();
            if (CollectionUtils.isNotEmpty(resourceList) && resourceList.size() == 1) {
                AgentMetaEnum resourceType = resourceList.get(0).getResourceType();
                metadata.put("resourceName", resourceList.get(0).getResourceName());
                metadata.put("resourceType", resourceType);
                // 加一个mode -- 只有当不是搜问和智办模式，才会写入resourceId
                boolean isExpert = Constants.SEARCH_QUERY_MODE.equals(assistantChatDto.getMode())
                    || Constants.SMART_OFFICE.equals(assistantChatDto.getMode());
                if (!isExpert) {
                    metadata.put("resourceId", resourceList.get(0).getResourceId());
                }

                // 如果是数字员工，需要加上agentType
                if (AgentMetaEnum.DIG_EMPLOYEE.equals(resourceType)) {
                    metadata.put("agentType", assistantChatDto.getAgentType());
                }
            }
        }
        catch (Exception e) {
            log.error("增加智能体，聊天消息等标题，头像异常！！{}", e.getMessage(), e);
        }
        return metadata;
    }

    /**
     * 多端广播：将 appStreamResponse 推送到用户的其他设备
     */
    private void broadcastAppStreamResponse(ChatProcessContext ctx) {
        try {
            if (ctx.chatResponse != null) {
                multiDeviceBroadcastService.broadcastToUserDevices(ctx.userId, ctx.sessionId,
                    SseResponseEventEnum.appStreamResponse, JSON.toJSONString(ctx.chatResponse), ctx.senderChannel);
            }
        }
        catch (Exception e) {
            log.warn("多端广播 appStreamResponse 事件异常, sessionId: {}", ctx.sessionId, e);
        }
    }

    /**
     * 异常处理：统一处理主流程中的异常，记录索引、抛出业务异常等。
     */
    @Override
    public void handleException(ChatProcessContext ctx) {
        try {
            saveExceptionRequiresNew(ctx);
        }
        catch (Exception e) {
            log.error(
                "save error in handleException(requires_new), sessionId={}, taskId={}, "
                    + "exceptionType={}, exceptionMsg={}, saveError={}",
                ctx == null ? null : ctx.getSessionId(), ctx == null ? null : ctx.getTaskId(),
                ctx == null || ctx.exception == null ? null : ctx.exception.getClass().getName(),
                ctx == null || ctx.exception == null ? null : ctx.exception.getMessage(), e.getMessage(), e);
        }

        if (ctx.exception instanceof PythonRuntimeException) {
            throw (PythonRuntimeException) ctx.exception;
        }
        else {
            throw new BdpRuntimeException(ctx.exception.getMessage(), ctx.exception);
        }
    }

    private void saveExceptionRequiresNew(ChatProcessContext ctx) {
        if (ctx == null || ctx.assistantChatDto == null) {
            return;
        }

        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        template.execute(status -> {
            // 写入 session 信息 + 消息索引落库：独立事务提交，避免外层异常回滚导致“白写”
            writeSession(ctx);

            float taskDueTime = (System.currentTimeMillis() - ctx.startTime) / 1000.0f;
            resolveMemory(ctx, ctx.assistantChatDto, ctx.sessionId, ctx.messageContext, ctx.resMsg);
            messageFactory.saveMessageIndex(ctx.taskId, ctx.askMsg, ctx.askMsg, taskDueTime,
                Constants.ResponseStatus.FALSE, ctx);

            // 更新使用次数
            increaseSessionMember(ctx);
            return null;
        });
    }

    private void writeSession(ChatProcessContext ctx) {
        AssistantChatDto assistantChatDto = ctx.assistantChatDto;
        Long sessionId = assistantChatDto.getSessionId();
        ByaiSession byId = sessionService.findById(sessionId);
        if (byId == null) {
            // 往 byai_session 表中插入数据（兜底：assistantChatDto.session 可能为 null）
            SessionMembersDto session = assistantChatDto.getSession();
            if (session == null) {
                session = buildSessionFromAssistantChatDto(assistantChatDto, sessionId);
            }
            sessionService.createSessionMembers(session);
        }
    }

    /**
     * assistantChatDto.session 在部分场景下可能未回填（例如 sessionId 由上层动态创建后发生异常回滚）。 这里根据当前请求信息兜底构造 SessionMembersDto，保证异常处理仍能补写
     * session。
     */
    private SessionMembersDto buildSessionFromAssistantChatDto(AssistantChatDto dto, Long sessionId) {
        SessionMembersDto sessionMembersDto = new SessionMembersDto();
        sessionMembersDto.setSessionId(sessionId);
        sessionMembersDto.setSessionContent(dto.getChatContent());
        sessionMembersDto.setObjectType("DigEmployee"); // ConversationObjectType.DIGITAL_EMPLOYEES
        sessionMembersDto.setObjectId(dto.getAgentId());

        String chatContent = dto.getChatContent();
        String sessionNameSource = chatContent == null ? "" : chatContent;
        sessionMembersDto
            .setSessionName(ChatUtils.truncateString(sessionNameSource.replaceAll("\\{\\{.*?\\}\\}", ""), 10));

        sessionMembersDto.setCreatorId(CurrentUserHolder.getCurrentUserId());
        sessionMembersDto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        String sessionType = dto.getSessionType();
        sessionMembersDto.setSessionType(StringUtils.isNotBlank(sessionType) ? sessionType : "h_as");
        sessionMembersDto.setIsDebug(dto.getIsDebug());
        sessionMembersDto.setSessionExts(dto.getSessionExts());

        List<ByaiSessionMember> members = new ArrayList<>();
        if (dto.getAgentId() != null) {
            ByaiSessionMember agentMember = new ByaiSessionMember();
            agentMember.setByaiSessionMemberId(sequenceService.nextVal());
            agentMember.setSessionId(sessionId);
            agentMember.setComAcctId(CurrentUserHolder.getEnterpriseId());
            agentMember.setMemName("数字助理");
            agentMember.setMemObjId(dto.getAgentId());
            agentMember.setMemObjType("AGENT");
            agentMember.setUserRole("MEMBER");
            agentMember.setCreateTime(new Date());
            agentMember.setCreatorId(CurrentUserHolder.getCurrentUserId());
            members.add(agentMember);
        }
        sessionMembersDto.setMembers(members);
        return sessionMembersDto;
    }

    /**
     * 更新使用次数
     *
     * @param ctx 上下文
     */
    private void increaseSessionMember(ChatProcessContext ctx) {
        Long sessionId = ctx.getSessionId();
        Set<Long> allAgentIds = new HashSet<>();
        List<ResourceVo> resourceList = ctx.getAssistantChatDto().getResourceList();
        for (int i = 0; resourceList != null && i < resourceList.size(); i++) {
            ResourceVo resourceVo = resourceList.get(i);
            if (AgentMetaEnum.DIG_EMPLOYEE.getCode().equalsIgnoreCase(resourceVo.getResourceType().getCode())) {
                allAgentIds.add(Long.parseLong(resourceVo.getResourceId()));
            }
        }
        if (CollectionUtils.isNotEmpty(ctx.getAgentIds())) {
            allAgentIds.addAll(ctx.getAgentIds());
        }
        // 更新使用次数
        for (Long agentId : allAgentIds) {
            ByaiSessionMember sessionMember = sessionMemberService.findSessionMember(sessionId, "AGENT", agentId);
            if (sessionMember == null) {
                sessionMember = new ByaiSessionMember();
                sessionMember.setByaiSessionMemberId(sequenceService.nextVal());
                sessionMember.setSessionId(sessionId);
                sessionMember.setCreatorId(CurrentUserHolder.getCurrentUserId());
                sessionMember.setCreateTime(new Date());
                sessionMember.setRequestCount(1L);
                sessionMember.setMemObjId(agentId);
                sessionMember.setMemObjType("AGENT");
                sessionMember.setUserRole("MEMBER");
                sessionMember.setComAcctId(CurrentUserHolder.getEnterpriseId());
                sessionMemberService.save(sessionMember);
            }
            else {
                Long currentCount = sessionMember.getRequestCount();
                sessionMember.setRequestCount((currentCount == null ? 0L : currentCount) + 1L);
                sessionMemberService.updateById(sessionMember);
            }
        }
    }

    /**
     * 聊天主流程入口，调用模板方法执行主流程（带首词响应开始时间）。
     *
     * @param res SSE输出流
     * @param assistantChatDto 聊天请求参数
     * @param firstTextStartTime 首词响应开始时间（毫秒）
     */
    public void executeAssistantChat(OutputStream res, AssistantChatDto assistantChatDto, Long firstTextStartTime) {
        execute(res, assistantChatDto, firstTextStartTime);
    }

    /**
     * 供 Redis 监听器在异步 Gateway 模式下调用：执行延迟的消息存储步骤。
     *
     * @param ctx 聊天流程上下文
     */
    public void executeStoreMessage(ChatProcessContext ctx) {
        storeMessage(ctx);
    }

    /**
     * 供 Redis 监听器在异步 Gateway 模式下调用：执行延迟的后置处理步骤。
     *
     * @param ctx 聊天流程上下文
     */
    public void executeAfterProcess(ChatProcessContext ctx) {
        afterProcess(ctx);
    }

    /**
     * 1.存储消息 2.异步更新回sessionContent(用作app回显或者显示最新的聊天内容)
     *
     * @param assistantChatDto 聊天请求参数
     * @param sessionId 会话ID
     * @param messageContext 消息上下文
     * @return 聊天响应对象
     */
    public ChatResponse resolveMemory(ChatProcessContext ctx, AssistantChatDto assistantChatDto, Long sessionId,
        MessageContext messageContext, ByaiMessageHotDtoDto resMsg) {

        ByaiMessageHotDto systemReponse = null;
        // 判断是否更新任务
        if (TaskOperateTypeEnum.UPDATE.equals(assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.RERUN.equals(assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.FEEDBACK.equals(assistantChatDto.getTaskOperateType())) {
            ByaiMessageHotDto byaiMessageHotDto = ctx.taskHistoryMessages.get(1);
            systemReponse = memoryMessageService.updateTaskMessage(ctx, byaiMessageHotDto, messageContext);

        }
        else {
            messageContext.setTaskId(ctx.taskId);
            // 待办过来的获取前端给的beyondTaskId
            Optional.ofNullable(assistantChatDto).map(AssistantChatDto::getExtParams)
                .filter(params -> params.containsKey("beyondTaskId"))
                .ifPresent(params -> messageContext.setTaskId(MapParamUtil.getLongValue(params, "beyondTaskId"))); // 保存LLM应答的信息
            systemReponse = memoryMessageService.save(sessionId, SYSTEM_RESPONSE.getCode(), messageContext,
                assistantChatDto);
        }

        BeanUtils.copyProperties(systemReponse, resMsg);
        if (assistantChatDto.getAgentId() != null) {
            resMsg.setObjType(ChatObjType.AGENT);
            resMsg.setObjId(assistantChatDto.getAgentId());
        }
        else {
            resMsg.setObjType(ChatObjType.SUASS);
            resMsg.setObjId(CurrentUserHolder.getAssistantId());
        }

        // 构建响应对象
        ChatResponse chatResponse = new ChatResponse();
        chatResponse.setSessionId(sessionId);
        chatResponse.setRelatedResources(messageContext.getChatRelatedResource());
        chatResponse.setMessageId(systemReponse.getMessageId());
        chatResponse.setQueryMessageId(ctx.userMessageId);
        chatResponse.setResComIds(systemReponse.getResComIds());
        chatResponse.setRelatedQuestions(ctx.getSuggestionQuestion().getRelatedQuestions());

        SessionOpeartorDto sessionOpeartorDto = new SessionOpeartorDto();
        sessionOpeartorDto.setSessionId(sessionId);
        sessionOpeartorDto.setSessionContent(ChatUtils.truncateString(systemReponse.getMessageContent(), 50));
        // 异步更新回sessionContent(用作app回显或者显示最新的聊天内容)
        sessionApplicationService.updateConversationAsync(sessionOpeartorDto);
        return chatResponse;
    }

    public String getDate() {
        // 为了避免多线程问题先每个创建(可优化)
        SimpleDateFormat simpleDateFormat = new SimpleDateFormat(date_format);
        return simpleDateFormat.format(new Date());
    }

    /*
     * 规划的产生一个父任务，taskId是之前就默认生成的了后面算法会一直透传 前端还得必须给卡片资源id
     */
    private void addMenTask(ChatProcessContext ctx) {
        MenTask menTaskDto = new MenTask();
        menTaskDto.setTaskId(ctx.taskHistoryMessages.get(0).getTaskId());
        menTaskDto.setTaskType(TaskTypeEnum.INPUT.getCode());
        menTaskDto.setSystemNo(SystemCodeEnum.BYAI.getCode());

        ByaiMessageHotDto messageDto = ctx.taskHistoryMessages.get(1);
        String messageStruct = messageDto.getMessageStruct();
        List<AnswerDelta> answerDeltas = JSON.parseArray(messageStruct, AnswerDelta.class);
        Optional<AnswerDelta> firstAnswer = answerDeltas.stream()
            .filter(item -> MessageContentTypeEnum.TASK.getCode().equals(item.getContentType())).findFirst();
        if (firstAnswer.isPresent()) {
            AnswerDelta answer = firstAnswer.get();
            String content = answer.getChoices().get(0).getDelta().getContent();
            Map<String, Object> object = JSON.parseObject(content);
            String desc = (String) object.get("task_description");
            if (desc == null || desc.isEmpty()) {
                menTaskDto.setTitle("规划产生的任务");
            }
            else {
                menTaskDto.setTitle(desc.length() > 300 ? desc.substring(0, 300) + "..." : desc);
            }
        }
        else {
            menTaskDto.setTitle("规划产生的任务");
        }

        menTaskDto.setContent(ctx.taskHistoryMessages.get(0).getMessageContent());
        menTaskDto.setResComId(MapParamUtil.getLongValue(ctx.assistantChatDto.getExtParams(), "resComId"));
        menTaskDto.setSessionId(ctx.sessionId);
        // 怕重复点击产生重复的待办。判断一下任务id
        MenTask checkTask = menTaskService.getTaskById(menTaskDto.getTaskId());
        if (null != checkTask) {
            logger.error("addMenTask规划任务执行taskId已经存在检查是否是重复点击了：{}", checkTask.getTaskId());
            return;
        }
        menTaskService.addMenTask(menTaskDto, null);
    }

    @Override
    public void afterProcess(ChatProcessContext ctx) {
        if (TaskOperateTypeEnum.UPDATE.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.RERUN.equals(ctx.assistantChatDto.getTaskOperateType())
            || TaskOperateTypeEnum.FEEDBACK.equals(ctx.assistantChatDto.getTaskOperateType())) {
            // 更新任务记录
            messageFactory.updateMessageIndex(ctx.taskMessageIndex.getRelId(), ctx.taskId, ctx.askMsg, ctx.resMsg);
        }
        else {
            if (ctx.resMsg.getMessageId() == null) {
                ctx.resMsg = memoryMessageService.save(ctx.sessionId, SYSTEM_RESPONSE.getCode(), ctx.messageContext,
                    ctx.assistantChatDto);
            }
            float taskDueTime = (System.currentTimeMillis() - ctx.startTime) / 1000.0f;
            // byai_message_hotcold\relobj
            messageFactory.saveMessageIndex(ctx.taskId, ctx.askMsg, ctx.resMsg, taskDueTime,
                Constants.ResponseStatus.SUCCESS, ctx);
        }

        // 更新会话记录数
        increaseSessionMember(ctx);

        // 更新知识库的调用次数
        insertrUpdateDatasetUse(ctx);
    }

    private void insertrUpdateDatasetUse(ChatProcessContext ctx) {
        // 更新使用次数
        Long sessionId = ctx.getSessionId();
        Set<Long> datasetIds = ctx.getDatasetIds();
        if (CollectionUtils.isEmpty(datasetIds)) {
            return;
        }
        for (Long datasetId : datasetIds) {
            // 查询知识库详情的
            ByaiSessionMember sessionMember = sessionMemberService.findSessionMember(sessionId, "DOC", datasetId);
            if (sessionMember == null) {
                sessionMember = new ByaiSessionMember();
                sessionMember.setByaiSessionMemberId(sequenceService.nextVal());
                sessionMember.setSessionId(sessionId);
                sessionMember.setCreatorId(CurrentUserHolder.getCurrentUserId());
                sessionMember.setCreateTime(new Date());
                sessionMember.setRequestCount(1L);
                sessionMember.setMemObjId(datasetId);
                sessionMember.setMemObjType("DOC");
                sessionMember.setUserRole("MEMBER");
                sessionMember.setComAcctId(CurrentUserHolder.getEnterpriseId());
                sessionMemberService.save(sessionMember);
            }
            else {
                Long currentCount = sessionMember.getRequestCount();
                sessionMember.setRequestCount((currentCount == null ? 0L : currentCount) + 1L);
                sessionMemberService.updateById(sessionMember);
            }
        }
    }
}
