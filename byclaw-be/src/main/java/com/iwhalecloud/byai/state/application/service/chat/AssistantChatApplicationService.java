package com.iwhalecloud.byai.state.application.service.chat;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxEndpointService;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.MessageStructDto;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.FileUploadDto;
import com.iwhalecloud.byai.state.domain.chat.dto.PrologueDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.SessionRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.service.SessionRuntimeStateService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketPublisher;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.util.*;

/**
 * @author he.duming
 * @date 2025-11-18 13:57:48
 * @description TODO
 */

@Slf4j
@Service
public class AssistantChatApplicationService {

    private final GatewayClient<?> gatewayClient;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SessionTitleService sessionTitleService;

    @Autowired
    private FilesService filesService;

    @Autowired
    private ConversationStoragePathResolver conversationStoragePathResolver;

    @Autowired
    private ConversationFileStorage conversationFileStorage;

    @Autowired
    private TargetAgentResolver targetAgentResolver;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private ByaiMessageRelObjService byaiMessageRelObjService;

    @Autowired
    private RunningOutputStreamRegistry runningOutputStreamRegistry;

    @Autowired
    private RunningChatSnapshotService runningChatSnapshotService;

    @Autowired
    private TaskPlanApplicationService taskPlanApplicationService;

    @Autowired
    private TaskPlanWebSocketPublisher taskPlanWebSocketPublisher;

    @Autowired
    private OutputStreamManager outputStreamManager;

    // 使用 @Lazy 打破依赖环：ScriptService 经由 paramService → ... → dingtalk 链路最终又依赖本类。
    @Lazy
    @Autowired
    private ScriptService scriptService;

    @Autowired
    private SessionStreamManager sessionStreamManager;

    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;

    @Autowired
    private SessionRuntimeStateService sessionRuntimeStateService;

    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private SandboxEndpointService sandboxEndpointService;

    AssistantChatApplicationService(GatewayClient<?> gatewayClient) {
        this.gatewayClient = gatewayClient;
    }

    /**
     * 查询会话上下文使用量。
     * <p>
     * 状态优先从 Redis 读取；Redis 未命中时再按会话关联对象和默认主助手字段回退，
     * 最后从用户沙箱实时查询并回写缓存。这样既能减少沙箱请求，也能兼容历史会话或
     * agentId 表示不一致导致的缓存未命中场景。
     *
     * @param sessionId 会话 ID
     * @param agentId   当前请求使用的数字员工 ID，可为空
     * @return 会话状态，所有来源均不可用时返回结构化的不可用状态
     */
    public JSONObject getSessionStatus(String sessionId, Long agentId) throws IOException {
        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.session.id.not.empty"));
        }

        Long resolveAgentId = targetAgentResolver.resolveAgentId(agentId);

        // 1. Redis 精确查询：优先按当前请求解析后的 agentId 获取状态。
        JSONObject status = parseSessionStatus(readSessionStatusValue(sessionId, resolveAgentId));
        if (status != null) {
            return status;
        }

        // 2. 安全字段回退：尝试会话实际关联对象、main，以及唯一的 Hash 记录。
        status = readFallbackSessionStatus(sessionId, resolveAgentId);
        if (status != null) {
            return status;
        }

        // 3. Redis 没有缓存时，回源到当前用户沙箱中的 OpenClaw session store，并回写缓存。
        status = querySandboxSessionStatus(sessionId, resolveAgentId);
        if (status != null) {
            cacheSessionStatus(sessionId, status, resolveStatusField(status, resolveAgentId));
            return status;
        }

        // 4. 没有任何可用来源时返回结构化状态，避免前端只能收到 data={}。
        return buildUnavailableSessionStatus(sessionId, resolveAgentId);
    }

    /**
     * 按指定 agentId 精确读取 Redis Hash 中的会话状态。
     */
    private String readSessionStatusValue(String sessionId, Long agentId) {
        Object value = redisTemplate.opsForHash()
            .get(buildSessionStatusKey(sessionId), resolveSessionStatusField(agentId));
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 处理状态字段不一致的兼容查询。
     * <p>
     * 依次尝试请求 agentId、会话表中的 objectId 和 main；只有 Hash 中恰好只有一条
     * 状态记录时，才使用该唯一记录，避免多个数字员工共用会话时串用其他员工状态。
     */
    private JSONObject readFallbackSessionStatus(String sessionId, Long resolveAgentId) {
        String statusKey = buildSessionStatusKey(sessionId);
        Set<String> triedFields = new LinkedHashSet<>();
        addStatusField(triedFields, resolveSessionStatusField(resolveAgentId));

        try {
            ByaiSession session = sessionService.findById(Long.valueOf(sessionId));
            if (session != null) {
                Long sessionAgentId = targetAgentResolver.resolveAgentId(session.getObjectId());
                addStatusField(triedFields, resolveSessionStatusField(sessionAgentId));
            }
        } catch (Exception e) {
            log.warn("查询会话关联数字员工失败, sessionId: {}", sessionId, e);
        }

        addStatusField(triedFields, SessionStreamManager.DEFAULT_SESSION_STATUS_FIELD);
        for (String field : triedFields) {
            JSONObject status = parseSessionStatus(readSessionStatusValue(statusKey, field));
            if (status != null) {
                return status;
            }
        }

        Map<Object, Object> entries = redisTemplate.opsForHash().entries(statusKey);
        if (entries.size() == 1) {
            Object onlyValue = entries.values().iterator().next();
            return parseSessionStatus(onlyValue == null ? null : String.valueOf(onlyValue));
        }
        return null;
    }

    /**
     * 按 Redis Key 和 Hash field 读取原始状态值。
     */
    private String readSessionStatusValue(String statusKey, String field) {
        Object value = redisTemplate.opsForHash().get(statusKey, field);
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 添加待尝试的状态字段，并利用 Set 去重空值和重复字段。
     */
    private void addStatusField(Set<String> fields, String field) {
        if (StringUtils.isNotBlank(field)) {
            fields.add(field);
        }
    }

    /**
     * 解析并校验状态 JSON；空值、非法 JSON 或明确的 ok=false 都视为未命中。
     */
    private JSONObject parseSessionStatus(String statusValue) {
        if (StringUtils.isBlank(statusValue)) {
            return null;
        }
        try {
            JSONObject status = JSON.parseObject(statusValue);
            return Boolean.FALSE.equals(status.getBoolean("ok")) ? null : status;
        } catch (Exception e) {
            log.warn("Session status 缓存不是有效 JSON", e);
            return null;
        }
    }

    /**
     * Redis 无状态时，从当前用户的 OpenClaw 沙箱 session store 实时获取状态。
     * 该方法只负责回源查询，不在这里缓存，缓存由调用方统一处理。
     */
    private JSONObject querySandboxSessionStatus(String sessionId, Long agentId) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        Map<String, String> searchQuery = new LinkedHashMap<>();
        searchQuery.put("sessionId", sessionId);
        if (agentId != null) {
            searchQuery.put("agentId", agentId.toString());
        }

        Request.Builder requestBuilder = sandboxEndpointService.newAuthorizedRequestBuilder(
            userCode, null, "/plugins/byai-channel/session-status", searchQuery);
        if (requestBuilder == null) {
            return null;
        }

        try (Response response = com.iwhalecloud.byai.common.util.OkHttpUtil.getHttpClient()
            .newCall(requestBuilder.get().build()).execute()) {
            ResponseBody body = response.body();
            String responseBody = body == null ? null : body.string();
            if (!response.isSuccessful()) {
                log.warn("查询沙箱 Session status 失败, sessionId: {}, httpStatus: {}", sessionId, response.code());
                return null;
            }
            return parseSessionStatus(responseBody);
        } catch (Exception e) {
            log.warn("查询沙箱 Session status 异常, sessionId: {}", sessionId, e);
            return null;
        }
    }

    /**
     * 将回源得到的有效状态按返回的 agentId 写入对应 Hash field；没有 agentId 时使用
     * 当前查询字段或 main，保证下一次查询可以优先命中 Redis。
     */
    private void cacheSessionStatus(String sessionId, JSONObject status, String fallbackField) {
        if (status == null) {
            return;
        }
        String field = StringUtils.defaultIfBlank(status.getString("agentId"), fallbackField);
        if (StringUtils.isBlank(field)) {
            field = SessionStreamManager.DEFAULT_SESSION_STATUS_FIELD;
        }
        redisTemplate.opsForHash().put(buildSessionStatusKey(sessionId), field, status.toJSONString());
    }

    /**
     * 确定回源状态应该写入的 Redis Hash field。
     */
    private String resolveStatusField(JSONObject status, Long agentId) {
        return StringUtils.defaultIfBlank(status.getString("agentId"), resolveSessionStatusField(agentId));
    }

    /**
     * 构造统一的无可用状态结果，避免接口成功时返回空 data 对象，便于前端区分暂无数据。
     */
    private JSONObject buildUnavailableSessionStatus(String sessionId, Long agentId) {
        JSONObject status = new JSONObject();
        status.put("ok", true);
        status.put("exists", false);
        status.put("sessionId", sessionId);
        status.put("agentId", agentId == null
            ? SessionStreamManager.DEFAULT_SESSION_STATUS_FIELD : String.valueOf(agentId));
        status.put("fresh", false);
        status.put("usedTokens", null);
        status.put("contextTokens", null);
        status.put("percent", null);
        status.put("source", "unavailable");
        return status;
    }

    private String buildSessionStatusKey(String sessionId) {
        return SessionStreamManager.SESSION_STATUS_KEY_PREFIX + sessionId
            + SessionStreamManager.SESSION_STATUS_KEY_SUFFIX;
    }

    private String resolveSessionStatusField(Long agentId) {
        return agentId == null ? SessionStreamManager.DEFAULT_SESSION_STATUS_FIELD : String.valueOf(agentId);
    }

    /**
     * 停止会话接口
     *
     * @param stopChatDto 入参
     */
    public void stopChat(StopChatDto stopChatDto) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return;
        }
        // STOP_CHAT 到达 BE 后，第一件事就是把仍为 ACTIVE 的计划直接落为 CANCELLED。
        List<TaskPlanSnapshot> cancelledPlans = taskPlanApplicationService.cancel(stopChatDto,
            "USER_STOPPED", "用户已停止执行");
        if (cancelledPlans != null) {
            cancelledPlans.forEach(plan -> taskPlanWebSocketPublisher.broadcast(
                CurrentUserHolder.getCurrentUserId(), plan, stopChatDto.getClientRequestId()));
        }

        // A runtime-backed execution completes cancellation asynchronously. Keep
        // its stream until the terminal event so final state and snapshots arrive.
        SessionRuntimeState projectedRuntime = sessionRuntimeStateService.get(stopChatDto.getSessionId());
        boolean waitForRuntimeCancellation = projectedRuntime != null
            && sessionStreamManager != null
            && sessionStreamManager.isSessionListenerActive(String.valueOf(stopChatDto.getSessionId()));
        boolean persistedBeforeStop = !waitForRuntimeCancellation && flushAccumulatedMessage(stopChatDto);
        RunningChatInfo runningInfo = runningOutputStreamRegistry.getRunning(stopChatDto.getSessionId());
        Long runningMessageId = runningInfo == null ? null : runningInfo.getModelAnswerMessageId();
        if (runningMessageId == null && chatRuntimeStateService != null) {
            ChatRuntimeState runtimeState = chatRuntimeStateService.get(stopChatDto.getSessionId());
            if (runtimeState != null) {
                runningMessageId = runtimeState.getModelAnswerMessageId();
            }
        }
        if (stopChatDto.getMessageId() == null) {
            stopChatDto.setMessageId(runningMessageId);
        }

        /*
        SsResource ssResource = ssResourceService.findById(stopChatDto.getAgentId());
        String workerAgentType = null;
        if (ssResource == null) {
            workerAgentType = WorkerAgentType.BYCLAW_EXE.getCode();
        }
        else {
            workerAgentType = ssResource.getWorkerAgentType();
        }

        String targetAgentType = targetAgentResolver.resolveAgentType(workerAgentType, stopChatDto.getAgentId(), null,
            CurrentUserHolder.getCurrentUserCode());

        String executionId = resolveStopExecutionId(stopChatDto);

        gatewayClient.cancelTask(executionId, String.valueOf(stopChatDto.getSessionId()),
            "user cancel task", targetAgentType, CurrentUserHolder.getCurrentUserCode(), "force");
        */
        try {
            gatewayClient.cancelSession(String.valueOf(stopChatDto.getSessionId()), "user cancel task");
            SessionRuntimeState cancelledRuntime = sessionRuntimeStateService.cancel(stopChatDto.getSessionId());
            if (cancelledRuntime != null) {
                JSONObject event = new JSONObject();
                event.put("type", "SESSION_RUNTIME_STATUS");
                event.put("sessionId", String.valueOf(cancelledRuntime.getSessionId()));
                event.put("traceId", cancelledRuntime.getTraceId());
                event.put("data", JSON.toJSON(cancelledRuntime));
                multiDeviceBroadcastService.broadcastRawToUser(CurrentUserHolder.getCurrentUserId(), event, null);
            }
        }
        catch (Exception e) {
            log.warn("stopChat 下游取消失败，计划已由 BE 更新为 CANCELLED, sessionId: {}",
                stopChatDto.getSessionId(), e);
        }

        Long cleanupMessageId = resolveStopCleanupMessageId(stopChatDto);

        if (persistedBeforeStop) {
            runningOutputStreamRegistry.release(stopChatDto.getSessionId(), cleanupMessageId);
            runningChatSnapshotService.delete(stopChatDto.getSessionId(), cleanupMessageId);
        } else if (!waitForRuntimeCancellation) {
            log.warn("stopChat 未确认已堆积消息落库，保留运行态与快照供恢复重试, sessionId: {}, messageId: {}",
                stopChatDto.getSessionId(), cleanupMessageId);
        }
    }

    private String resolveStopExecutionId(StopChatDto stopChatDto) {
        if (stopChatDto.getMessageId() != null) {
            return String.valueOf(stopChatDto.getMessageId());
        }
        if (StringUtils.isBlank(stopChatDto.getTraceId())) {
            return null;
        }
        try {
            Long modelAnswerMessageId = TraceIdCodec.decode(stopChatDto.getTraceId()).getModelAnswerMessageId();
            return modelAnswerMessageId == null ? null : String.valueOf(modelAnswerMessageId);
        } catch (Exception e) {
            log.warn("stopChat traceId 无法解析为 Gateway messageId, traceId={}", stopChatDto.getTraceId());
            return null;
        }
    }

    private Long resolveStopCleanupMessageId(StopChatDto stopChatDto) {
        if (stopChatDto.getMessageId() != null) {
            return stopChatDto.getMessageId();
        }
        if (StringUtils.isBlank(stopChatDto.getTraceId())) {
            return null;
        }
        try {
            return TraceIdCodec.decode(stopChatDto.getTraceId()).getModelAnswerMessageId();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 停止会话时将当前已堆积的消息落库。
     * <p>
     * 优先级：
     * <ol>
     *   <li>同 pod：本 pod 持有运行中的 {@link ChatProcessContext}。
     *     HTTP SSE 场景请求线程阻塞在事件队列上，向队列投递停止哨兵，由该线程按正常完成落库；
     *     其他场景（WebSocket / 无队列）直接调用 {@code flushOnStop} 落库。</li>
     *   <li>跨 pod：本 pod 没有上下文（监听器在其他 pod），退回到读取 Redis 运行态快照并幂等 upsert 落库。</li>
     * </ol>
     * 任一路径失败都不应阻断停止主流程（cancelTask 已执行），异常仅记录日志。
     *
     * @param stopChatDto 停止入参
     */
    private boolean flushAccumulatedMessage(StopChatDto stopChatDto) {
        Long sessionId = stopChatDto.getSessionId();
        if (sessionId == null) {
            return false;
        }
        Long cleanupMessageId = resolveStopCleanupMessageId(stopChatDto);
        try {
            ChatProcessContext ctx = outputStreamManager.getContext(String.valueOf(sessionId));
            if (ctx != null) {
                if (ctx.getGatewayEventQueue() != null) {
                    // 同 pod HTTP SSE：交给阻塞中的请求线程落库，保证写流仍在请求线程执行。
                    JSONObject sentinel = new JSONObject();
                    sentinel.put("event_type", ChatProcessContext.STOP_SENTINEL_EVENT);
                    sentinel.put("session_id", String.valueOf(sessionId));
                    try {
                        // 队列有界后必须等待已有事件被请求线程消费，确保停止哨兵不会静默丢失。
                        ctx.getGatewayEventQueue().put(sentinel);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw e;
                    }
                    // HTTP 请求线程消费停止哨兵后负责落库与清理，当前线程不能提前删除恢复数据。
                    return false;
                } else {
                    // 同 pod 但无队列（如 WebSocket）：直接落库收尾。
                    return scriptService.flushOnStop(ctx);
                }
            }
            // 跨 pod：本 pod 无上下文，从 Redis 快照落库。
            boolean flushed = scriptService.flushFromSnapshot(sessionId, cleanupMessageId);
            if (!flushed) {
                log.info("stopChat 无可落库内容（本 pod 无上下文且无快照）, sessionId: {}, messageId: {}", sessionId,
                    cleanupMessageId);
            }
            return flushed;
        } catch (Exception e) {
            log.error("stopChat 落库已堆积消息失败, sessionId: {}, messageId: {}", sessionId,
                cleanupMessageId, e);
        }
        // 只在本 pod 确实持有该 session 的 listener 时才停止。重启后前端补发的 STOP_CHAT 会落到
        // 没有任何上下文的新 pod 上，此时停止动作既无对象也会连带触发运行态清理，
        // 反而破坏重启恢复扫描赖以接管会话的运行态。
        if (sessionStreamManager != null && sessionStreamManager.isSessionListenerActive(String.valueOf(sessionId))) {
            sessionStreamManager.stopSessionListener(String.valueOf(sessionId));
        }
        return false;
    }

    /**
     * 文件上传
     *
     * @param multipartFiles 上传的文件
     * @param sessionId      会话
     * @param sessionType    会话类型
     * @param agentId        数字员工标志
     * @return UploadResult
     */
    public SessionUploadResult uploadFiles(MultipartFile[] multipartFiles, Long sessionId, String sessionType,
                                           Long agentId) throws Exception {
        return uploadFiles(multipartFiles, sessionId, sessionType, agentId, null);
    }

    /**
     * 文件上传并按项目创建临时会话。
     *
     * @param multipartFiles 上传的文件
     * @param sessionId      已有会话标识；为空时创建新会话
     * @param sessionType    会话类型
     * @param agentId        数字员工标识
     * @param projectId      新会话所属项目
     * @return UploadResult
     */
    public SessionUploadResult uploadFiles(MultipartFile[] multipartFiles, Long sessionId, String sessionType,
                                           Long agentId, Long projectId) throws Exception {

        // 检查文件是否合法
        this.checkUploadInfo(multipartFiles, agentId);

        // 创建会话
        ByaiSession session;
        if (sessionId == null || sessionId <= 0) {
            String sessionName = sessionTitleService.buildFileUploadTitle(new Date());

            String objectType = agentId == null ? ConversationObjectType.SUPER_ASSISTANT
                : ConversationObjectType.DIGITAL_EMPLOYEES;

            session = sessionService.createSession(sessionName, SessionType.H_AS.getCode(), agentId,
                objectType, DebugModeEnum.DEBUG_0.getNum(), projectId);

            sessionId = session.getSessionId();
            sessionTitleService.markInitialTitlePending(sessionId);
        } else {
            session = sessionService.findById(sessionId);
        }

        // 封装参数返回
        SessionUploadResult sessionUploadResult = new SessionUploadResult();
        sessionUploadResult.setSessionId(sessionId);
        if (session != null) {
            sessionUploadResult.setSessionName(session.getSessionName());
        }

        Map<String, Long> fileNameCountMap = new HashMap<String, Long>();

        for (MultipartFile multipartFile : multipartFiles) {

            // 创建文件上传
            String originalFilename = multipartFile.getOriginalFilename();
            String convertFileName = multipartFile.getOriginalFilename();


            long uploadCount = fileNameCountMap.getOrDefault(originalFilename, 0L);
            long dbCount = filesService.countSessionFile(sessionId, originalFilename);

            // 统计次数，如果已经上传过一次，防止同名覆盖，a.jpg将变成a(1).jpg
            long duplicateCount = uploadCount + dbCount;
            if (duplicateCount >= 1) {
                convertFileName = this.renameDuplicateFileName(originalFilename, duplicateCount);
            }

            //上传次数加1
            fileNameCountMap.put(originalFilename, uploadCount + 1);

            String userCode = CurrentUserHolder.getCurrentUserCode();
            StorageLocation location = conversationStoragePathResolver.conversationFile(userCode,
                String.valueOf(sessionId), convertFileName);

            byte[] bytes = multipartFile.getBytes();
            String contentType = multipartFile.getContentType();
            conversationFileStorage.writeBytes(location, bytes, contentType);

            // 替换请求地址
            String fileUrl = "/commonFile/preview?style=minio&bucketName={bucketName}&filePath={filePath}";
            fileUrl = fileUrl.replace("{bucketName}", location.getBucketOrRoot()).replace("{filePath}",
                location.getPath());

            // 记录文件信息
            Files byaiFiles = filesService.createUploadFile(originalFilename, convertFileName, contentType, null, -1L, sessionId,
                fileUrl);

            UploadItem uploadItem = new UploadItem();
            uploadItem.setFileId(byaiFiles.getFileId());
            uploadItem.setFileName(byaiFiles.getConvertFileName());
            uploadItem.setFilePath(conversationStoragePathResolver.normalizeDisplayFilePath(location.getPath()));
            uploadItem.setFileUrl(fileUrl);
            sessionUploadResult.getUploadItems().add(uploadItem);
        }

        return sessionUploadResult;
    }

    /**
     * 根据原始文件名和计数器，生成重命名后的文件名
     *
     * @param fileName       原始文件名 例：demo.txt
     * @param duplicateCount 计数器，0=不追加；1生成demo(1).txt；2生成demo(2).txt
     * @return 拼接完成的文件名
     */
    public String renameDuplicateFileName(String fileName, Long duplicateCount) {

        if (StringUtil.isEmpty(fileName)) {
            return "default";
        }

        if (duplicateCount <= 0) {
            return fileName;
        }

        int dotIndex = fileName.lastIndexOf('.');

        String baseName;
        String suffix;

        if (dotIndex > 0) {
            baseName = fileName.substring(0, dotIndex);
            suffix = fileName.substring(dotIndex);
        } else {
            baseName = fileName;
            suffix = "";
        }
        return String.format("%s(%d)%s", baseName, duplicateCount, suffix);
    }


    /**
     * 检查文件是否合规
     *
     * @param files   文件信息
     * @param agentId 智能体标识
     */
    @SuppressWarnings("PMD.UnusedPrivateMethod")
    private void checkUploadInfo(MultipartFile[] files, Long agentId) {

        // 优先根据数字员工查找配置
        FileUploadDto fileUpload = this.getFileUploadByAgentId(agentId);
        if (fileUpload == null) {
            String globalConf = byaiSystemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG");
            fileUpload = JSON.parseObject(globalConf, FileUploadDto.class);
        }

        boolean enabled = fileUpload.isEnabled();
        if (!enabled) {
            return;
        }

        // 校验文件数量和文件大小
        long maxFileCount = fileUpload.getMaxFileCount();
        long maxFileSizeMB = fileUpload.getMaxFileSize();
        if (files.length > maxFileCount) {
            throw new BaseException(I18nUtil.get("file.upload.count.exceeded", maxFileCount, files.length));
        }

        // 校验文件大小（文件类型不做限制）
        for (MultipartFile multipartFile : files) {
            long size = multipartFile.getSize();
            if (size > (maxFileSizeMB * 1024 * 1024)) {
                // 将字节转换为MB，格式化在国际化文件中定义
                double sizeMB = size / 1024.0 / 1024.0;
                throw new BaseException(I18nUtil.get("file.upload.size.exceeded", maxFileSizeMB, sizeMB));
            }
        }
    }

    /**
     * 查询数字员工是否有配置，没有配置返回null
     *
     * @param agentId 数字员工标识
     * @return FileUploadDto
     */
    private FileUploadDto getFileUploadByAgentId(Long agentId) {
        if (agentId == null) {
            return null;
        }

        DigEmployeeExtQo extQo = new DigEmployeeExtQo();
        extQo.setResourceId(agentId);
        ResourceExtDigEmployeeDto digEmployeeExtDto = ssResExtDigEmployeeService.findExtDigEmployeeByQo(extQo);
        if (digEmployeeExtDto == null) {
            return null;
        }

        // 获取上传文件规则
        SsResExtDigEmployee ssResExtDigEmployee = digEmployeeExtDto.getSsResExtDigEmployee();
        if (ssResExtDigEmployee != null && StringUtil.isNotEmpty(ssResExtDigEmployee.getPrologue())) {
            PrologueDto prologueDto = JSON.parseObject(ssResExtDigEmployee.getPrologue(), PrologueDto.class);
            return prologueDto.getFileUpload();
        }
        return null;
    }

    /**
     * 更新消息结构
     *
     * @param messageStructDto 消息结构
     * @return ByaiMessage
     */
    public ByaiMessage updateMessageStructById(MessageStructDto messageStructDto) {

        ByaiMessage byaiMessage = byaiMessageHotService.find(messageStructDto.getMessageId());

        // 消息尚未入库，仅有运行中的快照
        if (byaiMessage == null) {
            return updateRunningSnapshotMessageStruct(messageStructDto);
        }

        // 判断是更新消息结构还是更新思考过程
        if ("inferLog".equalsIgnoreCase(messageStructDto.getUpdateField())) {
            String inferLog = byaiMessage.getInferLog();
            byaiMessage.setInferLog(this.replaceContent(inferLog, messageStructDto));
        } else {
            String messageStruct = byaiMessage.getMessageStruct();
            byaiMessage.setMessageStruct(this.replaceContent(messageStruct, messageStructDto));
        }

        byaiMessageHotService.update(byaiMessage);

        // 同步刷新运行中的快照与 messageContext，避免 storeMessage 用 messageContext 把改动覆盖回去
        syncRunningStateAfterUpdate(messageStructDto);

        return byaiMessage;
    }

    /**
     * 更新运行中的会话快照中的消息结构 / 思考过程，并同步更新 messageContext，使后续 storeMessage 持久化时使用更新后的内容。
     *
     * @param messageStructDto 消息更新入参
     * @return 与数据库更新一致的消息实体（仅设置 messageId / messageStruct / inferLog）
     */
    private ByaiMessage updateRunningSnapshotMessageStruct(MessageStructDto messageStructDto) {
        RunningChatSnapshotResponse snapshot = locateSnapshot(messageStructDto);
        if (snapshot == null) {
            return null;
        }

        if ("inferLog".equalsIgnoreCase(messageStructDto.getUpdateField())) {
            snapshot.setInferLog(this.replaceContent(snapshot.getInferLog(), messageStructDto));
        } else {
            snapshot.setMessageStruct(this.replaceContent(snapshot.getMessageStruct(), messageStructDto));
        }

        runningChatSnapshotService.updateSnapshot(snapshot);
        replaceMessageContextContent(snapshot.getSessionId(), messageStructDto);

        ByaiMessage byaiMessage = new ByaiMessage();
        byaiMessage.setMessageId(snapshot.getMessageId());
        byaiMessage.setMessageStruct(snapshot.getMessageStruct());
        byaiMessage.setInferLog(snapshot.getInferLog());
        return byaiMessage;
    }

    /**
     * 命中 DB 时，仍需同步更新运行中的快照与 messageContext：消息可能仍处于追加（APPEND）状态， 后续 storeMessage 会基于 messageContext
     * 重写 messageStruct / inferLog，否则刚刚的改动会被覆盖。
     */
    private void syncRunningStateAfterUpdate(MessageStructDto messageStructDto) {
        RunningChatSnapshotResponse snapshot = locateSnapshot(messageStructDto);
        if (snapshot == null) {
            return;
        }
        if ("inferLog".equalsIgnoreCase(messageStructDto.getUpdateField())) {
            snapshot.setInferLog(this.replaceContent(snapshot.getInferLog(), messageStructDto));
        } else {
            snapshot.setMessageStruct(this.replaceContent(snapshot.getMessageStruct(), messageStructDto));
        }
        runningChatSnapshotService.updateSnapshot(snapshot);
        replaceMessageContextContent(snapshot.getSessionId(), messageStructDto);
    }

    /**
     * 优先用 sessionId + traceId / messageId 精确命中快照，拿不到时退回到按 messageId 全量扫描。
     */
    private RunningChatSnapshotResponse locateSnapshot(MessageStructDto messageStructDto) {
        if (messageStructDto.getSessionId() != null) {
            RunningChatSnapshotResponse snapshot = runningChatSnapshotService.get(messageStructDto.getSessionId(),
                messageStructDto.getTraceId(), messageStructDto.getMessageId());
            if (snapshot != null) {
                return snapshot;
            }
        }
        return runningChatSnapshotService.findByMessageId(messageStructDto.getMessageId());
    }

    /**
     * 在运行中的 ChatProcessContext.messageContext 中，按 id 替换 answerMessageList 或 reasonMessageList 内的 content， 以保证最终
     * storeMessage → resolveMemory 持久化时与快照保持一致。
     */
    private void replaceMessageContextContent(Long sessionId, MessageStructDto messageStructDto) {
        if (sessionId == null) {
            return;
        }
        ChatProcessContext ctx = outputStreamManager.getContext(String.valueOf(sessionId));
        if (ctx == null || ctx.messageContext == null) {
            return;
        }
        List<AnswerDelta> target = "inferLog".equalsIgnoreCase(messageStructDto.getUpdateField())
            ? ctx.messageContext.getReasonMessageList()
            : ctx.messageContext.getAnswerMessageList();
        if (target == null || target.isEmpty()) {
            return;
        }
        for (AnswerDelta delta : target) {
            if (delta == null || !StringUtil.isNotEmpty(delta.getId())
                || !delta.getId().equals(messageStructDto.getId())) {
                continue;
            }
            if (CollectionUtils.isEmpty(delta.getChoices())) {
                continue;
            }
            delta.getChoices().forEach(choice -> {
                if (choice != null && choice.getDelta() != null) {
                    choice.getDelta().setContent(messageStructDto.getContent());
                }
            });
        }
    }

    /**
     * 替换数组结构
     *
     * @param messageStruct    消息结构
     * @param messageStructDto 消息更新入参
     * @return String
     */
    private String replaceContent(String messageStruct, MessageStructDto messageStructDto) {

        if (StringUtil.isEmpty(messageStruct)) {
            return messageStruct;
        }

        JSONArray jsonArray = JSON.parseArray(messageStruct);

        for (int i = 0; i < jsonArray.size(); i++) {
            JSONObject jsonObject = jsonArray.getJSONObject(i);

            String id = jsonObject.getString("id");

            if (StringUtil.isNotEmpty(id) && id.equals(messageStructDto.getId())) {
                JSONArray choices = jsonObject.getJSONArray("choices");
                for (int j = 0; j < choices.size(); j++) {
                    JSONObject choice = choices.getJSONObject(j);
                    JSONObject delta = choice.getJSONObject("delta");
                    delta.put("content", messageStructDto.getContent());
                }
            }
        }
        return jsonArray.toJSONString();
    }

    /**
     * 根据消息ID获取 traceId。
     * <p>
     * 根据 byai_message_relobj 表查询：res_msg_id = messageId 或 ask_msg_id = messageId， 命中后取 ask_msg_id 与 res_msg_id 编码出
     * traceId。
     *
     * @param messageId 消息ID
     * @return traceId，未查询到关联记录时返回 null
     */
    public String getTraceIdByMessageId(Long messageId) {
        if (messageId == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.message.id.not.empty"));
        }
        List<ByaiMessageRelObjDto> relList = byaiMessageRelObjService.findByAskOrResMsgId(messageId);
        if (CollectionUtils.isEmpty(relList)) {
            return null;
        }
        ByaiMessageRelObjDto rel = relList.get(0);
        return ScriptService.getTraceId(rel.getAskMsgId(), rel.getResMsgId());
    }
}
