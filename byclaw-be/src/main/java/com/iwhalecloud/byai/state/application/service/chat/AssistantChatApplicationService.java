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
    private RedisTemplate<String, Object> redisTemplate;

    AssistantChatApplicationService(GatewayClient<?> gatewayClient) {
        this.gatewayClient = gatewayClient;
    }

    public JSONObject getSessionStatus(String sessionId, Long agentId) throws IOException {
        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.session.id.not.empty"));
        }
        Long resolveAgentId = targetAgentResolver.resolveAgentId(agentId);
        String statusValue = readSessionStatusValue(sessionId, resolveAgentId);
        if (StringUtils.isBlank(statusValue)) {
            return new JSONObject();
        }
        try {
            return JSON.parseObject(statusValue);
        } catch (Exception e) {
            throw new BdpRuntimeException("session status is not valid json", e);
        }
    }

    private String readSessionStatusValue(String sessionId, Long agentId) {
        Object value = redisTemplate.opsForHash()
            .get(buildSessionStatusKey(sessionId), resolveSessionStatusField(agentId));
        return value == null ? null : String.valueOf(value);
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
        // 停止前将已堆积的消息落库，避免本轮回答内容丢失。
        flushAccumulatedMessage(stopChatDto);

        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return;
        }
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

        TaskPlanSnapshot cancellingPlan = taskPlanApplicationService.requestCancellation(stopChatDto,
            "USER_STOPPED", "用户请求停止");
        taskPlanWebSocketPublisher.broadcast(CurrentUserHolder.getCurrentUserId(), cancellingPlan,
            stopChatDto.getClientRequestId());

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
        gatewayClient.cancelSession(String.valueOf(stopChatDto.getSessionId()), "user cancel task");

        Long cleanupMessageId = resolveStopCleanupMessageId(stopChatDto);

        TaskPlanSnapshot cancelledPlan = taskPlanApplicationService.confirmCancellation(stopChatDto,
            "USER_STOPPED", "用户已停止执行");
        taskPlanWebSocketPublisher.broadcast(CurrentUserHolder.getCurrentUserId(), cancelledPlan,
            stopChatDto.getClientRequestId());

        runningOutputStreamRegistry.release(stopChatDto.getSessionId(), cleanupMessageId);
        runningChatSnapshotService.delete(stopChatDto.getSessionId(), cleanupMessageId);
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
    private void flushAccumulatedMessage(StopChatDto stopChatDto) {
        Long sessionId = stopChatDto.getSessionId();
        if (sessionId == null) {
            return;
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
                    }
                    catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw e;
                    }
                } else {
                    // 同 pod 但无队列（如 WebSocket）：直接落库收尾。
                    scriptService.flushOnStop(ctx);
                }
                return;
            }
            // 跨 pod：本 pod 无上下文，从 Redis 快照落库。
            boolean flushed = scriptService.flushFromSnapshot(sessionId, cleanupMessageId);
            if (!flushed) {
                log.info("stopChat 无可落库内容（本 pod 无上下文且无快照）, sessionId: {}, messageId: {}", sessionId,
                    cleanupMessageId);
            }
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

        // 检查文件是否合法
        this.checkUploadInfo(multipartFiles, agentId);

        // 创建会话
        ByaiSession session;
        if (sessionId == null || sessionId <= 0) {
            String sessionName = sessionTitleService.buildFileUploadTitle(new Date());

            String objectType = agentId == null ? ConversationObjectType.SUPER_ASSISTANT
                : ConversationObjectType.DIGITAL_EMPLOYEES;

            session = sessionService.createSession(sessionName, SessionType.H_AS.getCode(), agentId,
                objectType, DebugModeEnum.DEBUG_0.getNum());

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
