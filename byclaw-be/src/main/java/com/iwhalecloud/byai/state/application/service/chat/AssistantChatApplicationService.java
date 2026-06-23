package com.iwhalecloud.byai.state.application.service.chat;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxEndpointService;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.MessageStructDto;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.FileUploadDto;
import com.iwhalecloud.byai.state.domain.chat.dto.PrologueDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.io.IOException;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-11-18 13:57:48
 * @description TODO
 */

@Service
public class AssistantChatApplicationService {

    private final GatewayClient<?> gatewayClient;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private FilesService filesService;

    @Autowired
    private SsResourceService ssResourceService;

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
    private RunningOutputStreamRegistry runningOutputStreamRegistry;

    @Autowired
    private RunningChatSnapshotService runningChatSnapshotService;

    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private SandboxEndpointService sandboxEndpointService;

    AssistantChatApplicationService(GatewayClient<?> gatewayClient) {
        this.gatewayClient = gatewayClient;
    }

    public ResponseUtil<Object> getSessionStatus(String sessionId, Long agentId) throws IOException {
        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.session.id.not.empty"));
        }
        String userCode = CurrentUserHolder.getCurrentUserCode();
        Map<String, String> searchQuery = new LinkedHashMap<>();
        searchQuery.put("sessionId", sessionId);
        Long resolvedAgentId = targetAgentResolver.resolveAgentId(agentId);
        if (resolvedAgentId != null) {
            searchQuery.put("agentId", resolvedAgentId.toString());
        }
        Request.Builder requestBuilder = sandboxEndpointService.newAuthorizedRequestBuilder(userCode, null,
            "/plugins/byai-channel/session-status", searchQuery);
        if (requestBuilder == null) {
            return ResponseUtil.fail("No running sandbox found");
        }
        requestBuilder.get();
        try (Response response = OkHttpUtil.getHttpClient().newCall(requestBuilder.build()).execute()) {
            ResponseBody body = response.body();
            String responseBody = body == null ? null : body.string();
            Object responseData = parseJsonObjectOrString(responseBody);
            if (!response.isSuccessful()) {
                return ResponseUtil.fail(responseBody);
            }
            return ResponseUtil.successResponse(responseData);
        }
    }

    private Object parseJsonObjectOrString(String responseBody) {
        if (StringUtils.isBlank(responseBody)) {
            return responseBody;
        }
        try {
            return JSON.parseObject(responseBody);
        }
        catch (Exception e) {
            return responseBody;
        }
    }

    /**
     * 停止会话接口
     *
     * @param stopChatDto 入参
     */
    public void stopChat(StopChatDto stopChatDto) {
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

        gatewayClient.cancelTask(String.valueOf(stopChatDto.getMessageId()), String.valueOf(stopChatDto.getSessionId()),
            "user cancel task", targetAgentType, CurrentUserHolder.getCurrentUserCode(), "force");
        runningOutputStreamRegistry.release(stopChatDto.getSessionId(), stopChatDto.getMessageId());
        runningChatSnapshotService.delete(stopChatDto.getSessionId(), stopChatDto.getMessageId());
    }

    /**
     * 文件上传
     *
     * @param multipartFiles 上传的文件
     * @param sessionId 会话
     * @param sessionType 会话类型
     * @param agentId 数字员工标志
     * @return UploadResult
     */
    public SessionUploadResult uploadFiles(MultipartFile[] multipartFiles, Long sessionId, String sessionType,
        Long agentId) throws Exception {

        // 检查文件是否合法
        this.checkUploadInfo(multipartFiles, agentId);

        // 创建会话
        if (sessionId == null || sessionId <= 0) {
            String sessionName = "File Upload " + DateUtils.getFormatedDate(new Date());

            String objectType = agentId == null ? ConversationObjectType.SUPER_ASSISTANT
                : ConversationObjectType.DIGITAL_EMPLOYEES;

            ByaiSession byaiSession = sessionService.createSession(sessionName, SessionType.H_AS.getCode(), agentId,
                objectType, DebugModeEnum.DEBUG_0.getNum());

            sessionId = byaiSession.getSessionId();
        }

        // 封装参数返回
        SessionUploadResult sessionUploadResult = new SessionUploadResult();
        sessionUploadResult.setSessionId(sessionId);

        for (MultipartFile multipartFile : multipartFiles) {

            // 创建文件上传
            String originalFilename = multipartFile.getOriginalFilename();

            String userCode = CurrentUserHolder.getCurrentUserCode();
            StorageLocation location = conversationStoragePathResolver.conversationFile(userCode,
                String.valueOf(sessionId), originalFilename);

            byte[] bytes = multipartFile.getBytes();
            String contentType = multipartFile.getContentType();
            conversationFileStorage.writeBytes(location, bytes, contentType);

            // 替换请求地址
            String fileUrl = "/commonFile/preview?style=minio&bucketName={bucketName}&filePath={filePath}";
            fileUrl = fileUrl.replace("{bucketName}", location.getBucketOrRoot()).replace("{filePath}",
                location.getPath());

            // 记录文件信息
            Files byaiFiles = filesService.createUploadFile(originalFilename, contentType, null, -1L, sessionId,
                fileUrl);

            UploadItem uploadItem = new UploadItem();
            uploadItem.setFileId(byaiFiles.getFileId());
            uploadItem.setFileName(byaiFiles.getFileName());
            uploadItem.setFilePath(conversationStoragePathResolver.normalizeDisplayFilePath(location.getPath()));
            uploadItem.setFileUrl(fileUrl);
            sessionUploadResult.getUploadItems().add(uploadItem);
        }

        return sessionUploadResult;
    }

    /**
     * 检查文件是否合规
     *
     * @param files 文件信息
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
        }
        else {
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
        }
        else {
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
        }
        else {
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
     * @param messageStruct 消息结构
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
}
