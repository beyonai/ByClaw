package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.manager.application.service.superassist.SuasSuperassistApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import jakarta.servlet.ServletOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.UrlUtil;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.common.util.ListUtil;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.util.SpanUtil;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageTaskDto;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.ChatInitializationDto;
import com.iwhalecloud.byai.state.domain.chat.model.ChatResponse;
import com.iwhalecloud.byai.state.domain.chat.model.ErrorReponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.men.enums.MenTaskStatusEnum;
import com.iwhalecloud.byai.state.domain.men.enums.TaskTypeEnum;
import com.iwhalecloud.byai.state.domain.men.service.MenResComService;
import com.iwhalecloud.byai.state.domain.men.service.MenTaskService;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.instrumentation.annotations.WithSpan;

@Service
public class AssistantChatService {

    private static final Logger logger = LoggerFactory.getLogger(AssistantChatService.class);

    @Autowired
    private ScriptService scriptService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private MemoryMessageService memoryMessageService;

    @Autowired
    private MenTaskService menTaskService;

    @Autowired
    private MenResComService menResComService;

    @Autowired
    private MessageFactory messageFactory;

    @Autowired
    private SessionMemberService sessionMemberService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SuasSuperassistApplicationService suasSuperassistApplicationService;

    /**
     * 对话处理方法（带首词响应开始时间）
     *
     * @param assistantChatDto 对话请求参数
     * @param outputStream 输出流
     * @param userInfo 用户信息
     * @throws IOException IO异常
     */
    @WithSpan(value = "chat", inheritContext = false)
    public void chat(AssistantChatDto assistantChatDto, OutputStream outputStream, LoginInfo userInfo)
        throws IOException {
        Span span = Span.current();
        if (assistantChatDto != null && span != null && assistantChatDto.getSessionId() != null) {
            span.setAttribute("sessionId", assistantChatDto.getSessionId());
            span.setAttribute("langfuse.trace.public", true);
            SpanUtil.input(span, assistantChatDto.getChatContent());
        }
        try {
            long firstTextStartTime = System.currentTimeMillis();
            long time01 = System.currentTimeMillis();
            // 给Netty使用
            if (userInfo != null) {
                CurrentUserHolder.setLoginInfo(userInfo);
            }

            if (assistantChatDto != null) {
                AssistantAccessChannel.fromAccessTerminal(assistantChatDto.getAccessTerminal())
                    .ifPresent(ch -> ch.ensureChannelTypeInExtension(assistantChatDto));
            }

            // 处理固化记忆
            Map<String, Object> extParams = assistantChatDto.getExtParams();
            String taskType = MapUtils.getString(extParams, "taskType");
            if (TaskTypeEnum.FIXMEMORY.getCode().equalsIgnoreCase(taskType)) {
                this.handleFixMemory(assistantChatDto, outputStream);
                return;
            }

            applyDefaultPersonalAssistant(assistantChatDto);

            // 处理sessionId相关逻辑,校验消息发送权限
            handleSessionLogic(outputStream, assistantChatDto);

            long time02 = System.currentTimeMillis();
            logger.info("chat time01:{}", time02 - time01);

            normalizeDefaultSuperAssistantAgentId(assistantChatDto);

            // 执行聊天处理：Gateway 模式下 handleGatewayMode() 内部阻塞等待 Redis 监听器完成，
            // 返回后即可安全执行 storeMessage/afterProcess，最终由 finally 关闭流
            executeChat(assistantChatDto, outputStream, firstTextStartTime);
        }
        catch (BdpRuntimeException e) {
            handleBdpRuntimeException(e, assistantChatDto, outputStream);
        }
        catch (Exception e) {
            handleGeneralException(e, outputStream);
        }
        finally {
            cleanupResources(userInfo, outputStream);
        }
    }

    /**
     * 处理固化记
     *
     * @param assistantChatDto 会话入参
     * @param outputStream 注
     */
    private void handleFixMemory(AssistantChatDto assistantChatDto, OutputStream outputStream) {

        ChatProcessContext context = new ChatProcessContext(outputStream, assistantChatDto);
        context.setStartTime(System.currentTimeMillis());

        Long sessionId = assistantChatDto.getSessionId();
        Long askMessageId = sequenceService.nextVal();
        Long respMessageId = sequenceService.nextVal();
        Long newTaskId = sequenceService.nextVal();
        Long newResComId = sequenceService.nextVal();
        if (sessionId == null) {
            // 先创建会话
            SessionMembersDto membersDto = this.createGroupChatSession(assistantChatDto);
            CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.createSession,
                JSON.toJSONString(membersDto), membersDto.getSessionId());
            sessionId = membersDto.getSessionId();
        }

        // 初始事件
        ChatInitializationDto chatInitializationDto = new ChatInitializationDto();
        chatInitializationDto.setMetadata(null);
        chatInitializationDto.setMessageId(askMessageId);
        chatInitializationDto.setQueryMessageId(askMessageId);
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.initialization,
            JSON.toJSONString(chatInitializationDto), sessionId);

        // 设置首次词开始时间
        context.setFirstTextStartTime(System.currentTimeMillis());

        // 保存任务到数据库
        MessageContext askMessageContext = new MessageContext();
        askMessageContext.setType(AgentTypeEnum.getNameCode(assistantChatDto.getAgentType()));
        askMessageContext.setMessageId(askMessageId);
        askMessageContext.setTaskId(newTaskId);
        askMessageContext.getAnswerText().append(assistantChatDto.getChatContent());
        ByaiMessageHotDtoDto askMessageDto = memoryMessageService.save(sessionId, ChatUseageEnum.USER_INPUT.getCode(),
            askMessageContext, assistantChatDto);

        // 设置首次响应结束时间
        context.setFirstTextEndTime(System.currentTimeMillis());

        // 生成回复内容
        MessageTaskDto messageTaskDto = this.saveMessageTask(assistantChatDto, newTaskId, newResComId);
        ChoiceDto choiceDto = new ChoiceDto();
        choiceDto.setDelta(new DeltaDto(JSON.toJSONString(messageTaskDto)));
        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setMessageId(respMessageId);
        answerDelta.setContentType(MessageContentTypeEnum.TASK.getCode());
        answerDelta.setChoices(Collections.singletonList(choiceDto));
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.answerDelta, JSON.toJSONString(answerDelta),
            sessionId);

        // 返回组件信息
        String resComIds = this.buildResComIds(newResComId);

        // 保存消息记录
        MessageContext respMessageContext = new MessageContext();
        respMessageContext.setType(AgentTypeEnum.getNameCode(assistantChatDto.getAgentType()));
        respMessageContext.setMessageId(answerDelta.getMessageId());
        respMessageContext.setTaskId(newTaskId);
        respMessageContext.setMessageStruct(answerDelta);
        respMessageContext.setAnswerMessageList(Collections.singletonList(answerDelta));
        respMessageContext.setResComIds(resComIds);
        respMessageContext.getAnswerText().append(JSON.toJSONString(messageTaskDto));
        ByaiMessageHotDtoDto resMessageDto = memoryMessageService.save(sessionId,
            ChatUseageEnum.SYSTEM_RESPONSE.getCode(), respMessageContext, assistantChatDto);

        // 设置响应问题和响应信息
        context.setAskMsg(askMessageDto);
        context.setResMsg(resMessageDto);
        context.setAgentIds(this.buildAgentIds(messageTaskDto));
        float taskDueTime = (System.currentTimeMillis() - context.getStartTime()) / 1000.0F;
        messageFactory.saveMessageIndex(newTaskId, askMessageDto, resMessageDto, taskDueTime,
            Constants.ResponseStatus.SUCCESS, context);

        // 响应
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.resComComplete, resComIds, sessionId);

        // 回答结
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.answerDelta, "[DONE]", sessionId);

        // 打印结束时间
        Map<String, Object> answerEnd = new HashMap<>();
        answerEnd.put("createtime", new Date());
        answerEnd.put("role", "assistant");
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.answerEnd, JSON.toJSONString(answerEnd),
            sessionId);

        // 结束标志,问答郑
        ChatResponse chatResponse = new ChatResponse();
        chatResponse.setResComIds(resComIds);
        chatResponse.setMessageId(respMessageId);
        chatResponse.setQueryMessageId(askMessageContext.getMessageId());
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.appStreamResponse,
            JSON.toJSONString(chatResponse), sessionId);

    }

    /**
     * 构建响应格式
     *
     * @param newResComId 组件标识
     * @return String
     */
    private String buildResComIds(Long newResComId) {
        List<Map<String, Object>> resComInfoList = new ArrayList<>();
        Map<String, Object> resComInfo = new HashMap<>();
        resComInfo.put("resComId", newResComId);
        resComInfo.put("contentType", MessageContentTypeEnum.TASK.getCode());
        resComInfoList.add(resComInfo);
        return JSON.toJSONString(resComInfoList);
    }

    /**
     * 解析出数据员工标识
     *
     * @param messageTaskDto 任务信息
     * @return Set<Long>
     */
    private Set<Long> buildAgentIds(MessageTaskDto messageTaskDto) {
        List<MessageTaskDto.Step> steps = messageTaskDto.getSteps();
        // 没有数字员工，跳过
        if (CollectionUtils.isEmpty(steps)) {
            return Collections.emptySet();
        }

        Set<Long> agentIds = new HashSet<>();
        for (MessageTaskDto.Step step : steps) {
            List<MessageTaskDto.TaskSubStep> subSteps = step.getSubSteps();
            // 为空，跳过
            if (CollectionUtils.isEmpty(subSteps)) {
                continue;
            }

            for (MessageTaskDto.TaskSubStep subStep : subSteps) {
                MessageTaskDto.ToolMetadata toolMetadata = subStep.getToolMetadata();
                if (toolMetadata != null) {
                    agentIds.add(toolMetadata.getToolId());
                }
            }
        }
        return agentIds;
    }

    /**
     * 保存数据库任务
     *
     * @param assistantChatDto 助手聊天信息
     * @param newTaskId 新建任务标识
     * @param newResComId 新建卡片标识
     * @return MessageTaskDto
     */
    private MessageTaskDto saveMessageTask(AssistantChatDto assistantChatDto, Long newTaskId, Long newResComId) {
        Map<String, Object> extParams = assistantChatDto.getExtParams();
        Long resComId = MapUtils.getLong(extParams, "resComId");

        MenResCom menResCom = menResComService.getRecCom(resComId);
        String resPage = menResCom.getResPage();
        MessageTaskDto messageTaskDto = JSON.parseObject(resPage, MessageTaskDto.class);

        // 设置唯一标识
        List<MessageTaskDto.Step> steps = messageTaskDto.getSteps();
        for (MessageTaskDto.Step step : steps) {
            List<MessageTaskDto.TaskSubStep> subSteps = step.getSubSteps();
            for (MessageTaskDto.TaskSubStep taskSubStep : subSteps) {
                taskSubStep.setId(UUID.randomUUID().toString().replace("-", ""));
            }
        }

        MenResCom newMenResCom = new MenResCom();
        newMenResCom.setResComId(newResComId);
        newMenResCom.setCreateBy(CurrentUserHolder.getCurrentUserId());
        newMenResCom.setCreateTime(new Date());
        newMenResCom.setResType(Integer.parseInt(MessageContentTypeEnum.TASK.getCode()));
        newMenResCom.setCreateTime(new Date());
        newMenResCom.setResPage(JSON.toJSONString(messageTaskDto));
        menResComService.save(newMenResCom);

        MenTask menTaskDto = menTaskService.findByResComId(resComId);
        MenTask newMenTaskDto = new MenTask();
        newMenTaskDto.setTaskId(newTaskId);
        newMenTaskDto.setTitle(menTaskDto.getTitle());
        newMenTaskDto.setTaskType(TaskTypeEnum.INPUT.getCode());
        newMenTaskDto.setCreateTime(new Date());
        newMenTaskDto.setCreateBy(CurrentUserHolder.getCurrentUserId());
        newMenTaskDto.setResComId(newMenResCom.getResComId());
        newMenTaskDto.setStatusCd(MenTaskStatusEnum.SUBMITTED.getCode());
        menTaskService.save(newMenTaskDto);

        return messageTaskDto;
    }

    /**
     * 处理文件URL
     */
    private void processFileUrls(AssistantChatDto assistantChatDto) {
        List<MessageFileDto> files = assistantChatDto.getFiles();
        if (CollectionUtils.isNotEmpty(files)) {
            files.forEach((t) -> {
                String completionConversationUrl = UrlUtil.getCompletionConversationUrl();
                String fileUrl = t.getFileUrl().replaceAll(completionConversationUrl, "");
                t.setFileUrl(UrlUtil.concatUrl(completionConversationUrl, fileUrl));
            });
        }
    }

    /**
     * 执行聊天处理
     */
    private void executeChat(AssistantChatDto assistantChatDto, OutputStream outputStream, long firstTextStartTime) {
        scriptService.executeAssistantChat(outputStream, assistantChatDto, firstTextStartTime);
    }

    /**
     * 处理BdpRuntimeException异常
     */
    private void handleBdpRuntimeException(BdpRuntimeException e, AssistantChatDto assistantChatDto,
        OutputStream outputStream) {
        logger.error(e.toString(), e);

        // 特殊处理用户被移除群聊的情况
        if (e.getMessage() != null && e.getMessage().contains("你不在当前群聊")) {
            String sessionId = String.valueOf(assistantChatDto.getSessionId());
            if (!"null".equals(sessionId) && StringUtils.isNotBlank(sessionId)) {
                handleUserRemovedFromGroup(outputStream, Long.valueOf(sessionId), CurrentUserHolder.getCurrentUserId());
                return;
            }
        }

        // 其他异常的处理
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.error,
            JSON.toJSONString(ErrorReponse.error(e.getMessage())), assistantChatDto.getSessionId());
        throw e;
    }

    /**
     * 处理一般异常
     */
    private void handleGeneralException(Exception e, OutputStream outputStream) {
        logger.error(e.toString(), e);
        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.error,
            JSON.toJSONString(ErrorReponse.error(e.getMessage())), null);
        throw new RuntimeException(e);
    }

    /**
     * 清理资源
     * <p>
     * 仅对 HTTP SSE（Servlet）输出流执行关闭操作。 WebSocket（Netty）场景下，OutputStream 为 NettyArrayOutputStream， 其生命周期由调用方的
     * try-with-resources 管理，此处不干预，避免误关 WebSocket 通道。
     */
    private void cleanupResources(LoginInfo userInfo, OutputStream outputStream) {
        if (outputStream instanceof ServletOutputStream) {
            try {
                outputStream.close();
            }
            catch (IOException e) {
                logger.error("Failed to close output stream", e);
            }
        }
    }

    /**
     * 处理sessionId相关逻辑 1. 当sessionId为空时，维护群成员关系 2. 当sessionId不为空时，检查当前用户是否在群成员列表中
     *
     * @param assistantChatDto 对话请求参数
     */
    private void handleSessionLogic(OutputStream outputStream, AssistantChatDto assistantChatDto) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        if (assistantChatDto.getSessionId() == null) {
            // sessionId为空时，维护群成员关系
            SessionMembersDto membersDto = createGroupChatSession(assistantChatDto);
            CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.createSession,
                JSON.toJSONString(membersDto));
        }
        else {
            // sessionId不为空时，检查当前用户是否在群成员列表中
            checkUserMembershipInGroup(assistantChatDto.getSessionId(), currentUserId, assistantChatDto);
        }
    }

    private void applyDefaultPersonalAssistant(AssistantChatDto assistantChatDto) {
        if (assistantChatDto == null || assistantChatDto.getAgentId() != null) {
            return;
        }
        Long defaultDigEmployeeId = suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId();
        if (defaultDigEmployeeId == null) {
            return;
        }
        assistantChatDto.setAgentId(defaultDigEmployeeId);
        if (StringUtils.isBlank(assistantChatDto.getAgentType())) {
            assistantChatDto.setAgentType(AgentTypeEnum.PERSONAL_QA_AGENT.getNameCode());
        }
        logger.info("未指定数字员工，使用当前用户默认个人助理回答, userId={}, agentId={}", CurrentUserHolder.getCurrentUserId(),
            defaultDigEmployeeId);
    }

    /**
     * 默认超级助手现在落库为真实 DIG_EMPLOYEE 资源，前端会传真实 resourceId。 但下游 Gateway 仍以 agentId=null 表示“main/超级助手”路由，因此这里统一通过
     * resourceCode 是否以 main 结尾来识别默认超级助手，避免继续依赖历史的 agentId=-1 哨兵值。
     *
     * @author qin.guoquan
     * @date 2026-05-09 15:20:00
     */
    private void normalizeDefaultSuperAssistantAgentId(AssistantChatDto assistantChatDto) {
        if (assistantChatDto == null || assistantChatDto.getAgentId() == null) {
            return;
        }
        SsResource ssResource = ssResourceService.findById(assistantChatDto.getAgentId());
        if (ssResource == null) {
            return;
        }
        boolean isDigitalEmployee = Constants.ResourceBizType.DIG_EMPLOYEE.equals(ssResource.getResourceBizType());
        boolean isDefaultSuperAssistant = StringUtils.endsWith(ssResource.getResourceCode(), "main");
        if (isDigitalEmployee && isDefaultSuperAssistant) {
            logger.info("识别到默认超级助手，清空agentId以沿用main路由, userId={}, agentId={}, resourceCode={}",
                CurrentUserHolder.getCurrentUserId(), assistantChatDto.getAgentId(), ssResource.getResourceCode());
            assistantChatDto.setAgentId(null);
        }
    }

    /**
     * 创建群聊会话并维护成员关系
     *
     * @param assistantChatDto 对话请求参数
     */
    public SessionMembersDto createGroupChatSession(AssistantChatDto assistantChatDto) {
        logger.info("开始创建群聊会话 - 当前用户ID: {}, agentId: {}", CurrentUserHolder.getCurrentUserId(),
            assistantChatDto.getAgentId());

        // 1. 创建MembersDto对象
        SessionMembersDto sessionMembersDto = new SessionMembersDto();
        Long newSessionId = sequenceService.nextVal();
        // 设置会话基本信息
        sessionMembersDto.setSessionId(newSessionId);
        sessionMembersDto.setSessionContent(assistantChatDto.getChatContent());
        sessionMembersDto.setObjectType(ConversationObjectType.DIGITAL_EMPLOYEES);
        sessionMembersDto.setObjectId(assistantChatDto.getAgentId());

        String chatContent = assistantChatDto.getChatContent();
        sessionMembersDto.setSessionName(ChatUtils.truncateString(chatContent.replaceAll("\\{\\{.*?\\}\\}", ""), 10));
        sessionMembersDto.setCreatorId(CurrentUserHolder.getCurrentUserId());
        sessionMembersDto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        sessionMembersDto.setSessionType(SessionType.H_AS.getCode());
        sessionMembersDto.setIsDebug(assistantChatDto.getIsDebug());
        sessionMembersDto.setSessionExts(assistantChatDto.getSessionExts());
        sessionMembersDto.setCreateTime(new Date());
        sessionMembersDto.setUpdateTime(new Date());
        // 2. 创建成员列表
        List<ByaiSessionMember> byaiSessionMembers = new ArrayList<>();

        // 4. 添加对应的数字助理作为成员
        if (assistantChatDto.getAgentId() != null) {
            ByaiSessionMember agentMember = this.createAgentMember(newSessionId, assistantChatDto.getAgentId());
            byaiSessionMembers.add(agentMember);
        }

        // 5. 调用groupService.createGroupChat()创建群聊
        sessionService.createSessionMembers(sessionMembersDto);

        // 6. 将新创建的sessionId设置回assistantChatDto
        assistantChatDto.setSessionId(newSessionId);

        assistantChatDto.setSession(sessionMembersDto);

        logger.info("群聊会话创建成功 - sessionId: {}, 成员数量: {}", newSessionId, byaiSessionMembers.size());
        return sessionMembersDto;

    }

    /**
     * 创建数字助理的成员对象
     *
     * @param sessionId 会话ID
     * @param agentId 数字助理ID
     * @return SessionMemberDto
     */
    private ByaiSessionMember createAgentMember(Long sessionId, Long agentId) {
        ByaiSessionMember agentMember = new ByaiSessionMember();
        agentMember.setByaiSessionMemberId(sequenceService.nextVal());
        agentMember.setSessionId(sessionId);
        agentMember.setComAcctId(CurrentUserHolder.getEnterpriseId());
        agentMember.setMemName(getAgentName(agentId));
        agentMember.setMemObjId(agentId);
        agentMember.setMemObjType(MemObjType.AGENT.name());
        agentMember.setUserRole(UserRole.MEMBER.name());
        agentMember.setCreateTime(new Date());
        agentMember.setCreatorId(CurrentUserHolder.getCurrentUserId());
        return agentMember;
    }

    /**
     * 获取数字助理名称
     *
     * @param agentId 数字助理ID
     * @return 助理名称
     */
    private String getAgentName(Long agentId) {
        SsResource ssResource = ssResourceService.findById(agentId);
        return ssResource == null ? "数字助理" : ssResource.getResourceName();
    }

    /**
     * 检查用户是否在群成员列表中 增强版本：先判断sessionType，只有群聊类型(hs_as)才需要检查群成员关系
     *
     * @param sessionId 会话ID
     * @param userId 用户ID
     * @param assistantChatDto 对话请求参数，可能包含sessionType
     */
    private void checkUserMembershipInGroup(Long sessionId, Long userId, AssistantChatDto assistantChatDto) {
        try {
            // 1. 首先尝试从请求参数中获取sessionType
            String sessionType = assistantChatDto.getSessionType();

            // 2. 如果请求参数中没有sessionType，则通过feign调用获取
            if (StringUtils.isBlank(sessionType)) {
                logger.debug("请求参数中没有sessionType，通过feign调用获取 - sessionId: {}", sessionId);
                sessionType = getSessionType(sessionId);
            }
            else {
                logger.debug("使用请求参数中的sessionType: {} - sessionId: {}", sessionType, sessionId);
            }

            // 3. 判断是否为群聊类型，只有群聊才需要检查成员关系
            if (!SessionType.HS_AS.getCode().equalsIgnoreCase(sessionType)) {
                logger.debug("会话 {} 的类型为 {}，不是群聊类型，跳过群成员检查", sessionId, sessionType);
                return; // 直接返回，不需要检查群成员关系
            }

            logger.debug("会话 {} 是群聊类型，开始检查用户 {} 的群成员关系", sessionId, userId);

            // 4. 查询当前用户是否在群成员列表中

            List<ByaiSessionMember> resultList = sessionMemberService.findSessionMembers(sessionId, "USER", userId);
            // 如果查询结果为空或失败，说明用户不在群成员列表中
            if (ListUtil.isEmpty(resultList)) {
                // 抛出自定义异常，让上层方法处理输出流写入
                throw new BdpRuntimeException(I18nUtil.get("chat.user.not.in.group"));
            }

            logger.debug("用户 {} 在会话 {} 中的群成员检查通过", userId, sessionId);

        }
        catch (BdpRuntimeException e) {
            logger.error("检查用户群成员关系失败 - sessionId: {}, userId: {}", sessionId, userId, e);
            throw e;
        }
        catch (Exception e) {
            logger.error("检查用户群成员关系失败 - sessionId: {}, userId: {}", sessionId, userId, e);
            throw new BdpRuntimeException(I18nUtil.get("chat.check.group.member.failed"), e);
        }
    }

    /**
     * 获取会话类型
     *
     * @param sessionId 会话ID
     * @return sessionType 会话类型
     */
    private String getSessionType(Long sessionId) {
        ByaiSession byaiSession = sessionService.findById(sessionId);
        if (byaiSession == null) {
            logger.warn("会话 {} 不存在，无法获取类型", sessionId);
            return null;
        }
        String sessionType = byaiSession.getSessionType();
        logger.debug("获取到会话 {} 的类型: {}", sessionId, sessionType);
        return sessionType;

    }

    /**
     * 处理用户被移除群聊的逻辑 通过输出流返回友好提示信息
     *
     * @param outputStream 输出流
     * @param sessionId 会话ID
     * @param userId 用户ID
     */
    private void handleUserRemovedFromGroup(OutputStream outputStream, Long sessionId, Long userId) {
        try {
            logger.warn("用户 {} 不在群聊 {} 中，返回友好提示", userId, sessionId);

            // 创建友好的错误响应
            ErrorReponse errorResponse = ErrorReponse.error("你不在当前群聊，无法继续对话。请刷新页面或联系群主重新加入。");

            // 通过SSE发送错误信息给前端
            CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.error, JSON.toJSONString(errorResponse));

            logger.info("已向用户 {} 发送群聊权限提示信息", userId);

        }
        catch (Exception e) {
            logger.error("发送用户群聊权限提示失败 - sessionId: {}, userId: {}", sessionId, userId, e);
        }
    }

}
