package com.iwhalecloud.byai.state.application.service.chat;

import com.alibaba.fastjson.JSON;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.impl.MinioStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.common.util.StringUtil;
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
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.state.domain.chat.dto.FileUploadDto;
import com.iwhalecloud.byai.state.domain.chat.dto.PrologueDto;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentTypeResolver;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.util.Date;
import java.util.List;

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
    private TargetAgentTypeResolver targetAgentTypeResolver;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;



    AssistantChatApplicationService(GatewayClient<?> gatewayClient) {
        this.gatewayClient = gatewayClient;
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

        String targetAgentType = targetAgentTypeResolver.resolve(workerAgentType, stopChatDto.getAgentId(), null,
            CurrentUserHolder.getCurrentUserCode());

        gatewayClient.cancelTask(String.valueOf(stopChatDto.getMessageId()), String.valueOf(stopChatDto.getSessionId()),
            "user cancel task", targetAgentType, CurrentUserHolder.getCurrentUserCode(), "force");
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
        List<String> allowedFileTypes = fileUpload.getAllowedFileTypes();
        if (files.length > maxFileCount) {
            throw new BaseException(I18nUtil.get("file.upload.count.exceeded", maxFileCount, files.length));
        }

        // 校验文件大小和文件类型
        for (MultipartFile multipartFile : files) {
            long size = multipartFile.getSize();
            if (size > (maxFileSizeMB * 1024 * 1024)) {
                // 将字节转换为MB，格式化在国际化文件中定义
                double sizeMB = size / 1024.0 / 1024.0;
                throw new BaseException(I18nUtil.get("file.upload.size.exceeded", maxFileSizeMB, sizeMB));
            }

            String fileSuffix = StringUtil.getFileSuffix(multipartFile.getOriginalFilename());
            if (!allowedFileTypes.contains(fileSuffix)) {
                String error = I18nUtil.get("file.upload.type.not.supported", StringUtils.join(allowedFileTypes, ","));
                throw new BaseException(error);
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


}
