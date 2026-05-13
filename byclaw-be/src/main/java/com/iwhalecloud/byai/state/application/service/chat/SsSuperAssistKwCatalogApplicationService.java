package com.iwhalecloud.byai.state.application.service.chat;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.CustomFilenameMultipartFile;
import java.io.IOException;
import java.util.List;
import com.iwhalecloud.byai.state.domain.assitsant.service.SuperassistService;
import com.iwhalecloud.byai.state.domain.chat.dto.FileUploadDto;
import com.iwhalecloud.byai.state.domain.chat.dto.PrologueDto;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/**
 * @author he.duming
 * @date 2025-04-22 00:48:48
 * @description TODO
 */
@Service
public class SsSuperAssistKwCatalogApplicationService {

    @Autowired
    private SuperassistService superassistService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    /**
     * 上传并构建文档 该方法用于处理文件上传和知识库重建的完整流程： 1. 获取用户个人对话知识库ID 2. 获取或创建知识库目录结构 3. 构建文件元数据信息 4. 调用知识库服务上传文件 5. 触发知识库重建索引 6.
     * 返回处理结果
     *
     * @param files 待上传的文件数组，支持多文件上传
     * @param sessionType 会话类型，用于区分不同类型的对话场景
     * @param sessionId 会话标识，用于关联具体的对话会话
     * @param agentId 数据员工ID
     * @return ResponseUtil 包含处理结果的响应对象
     */
    public UploadResult uploadFileAndRebuild(MultipartFile[] files, String sessionType, Long sessionId, Boolean isBuild,
        Long agentId) throws IOException {

        this.checkUploadInfo(files, agentId);

        // 步骤1: 获取用户的个人对话知识库ID
        Long resourceId = this.getDatasetId();

        return datasetApplicationService.uploadFiles(files, resourceId, null, null);

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
            throw new BaseRuntimeException(I18nUtil.get("file.upload.count.exceeded", maxFileCount, files.length));
        }

        // 校验文件大小和文件类型
        for (MultipartFile multipartFile : files) {
            long size = multipartFile.getSize();
            if (size > (maxFileSizeMB * 1024 * 1024)) {
                // 将字节转换为MB，格式化在国际化文件中定义
                double sizeMB = size / 1024.0 / 1024.0;
                throw new BaseRuntimeException(I18nUtil.get("file.upload.size.exceeded", maxFileSizeMB, sizeMB));
            }

            String fileSuffix = StringUtil.getFileSuffix(multipartFile.getOriginalFilename());
            if (!allowedFileTypes.contains(fileSuffix)) {
                String error = I18nUtil.get("file.upload.type.not.supported", StringUtils.join(allowedFileTypes, ","));
                throw new BaseRuntimeException(error);
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

        DigEmployeeExtQo digEmployeeExtQo = new DigEmployeeExtQo();
        digEmployeeExtQo.setResourceId(agentId);
        ResourceExtDigEmployeeDto digEmployeeExtDto = ssResExtDigEmployeeService
            .findExtDigEmployeeByQo(digEmployeeExtQo);
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

    private MultipartFile[] renameFiles(String fileName, MultipartFile[] files) {

        MultipartFile[] renamedFiles = new MultipartFile[files.length];
        for (int i = 0; i < files.length; i++) {
            MultipartFile originalFile = files[i];
            if (originalFile.isEmpty()) {
                renamedFiles[i] = originalFile;
                continue;
            }

            // 3. 用包装类包装原始文件，得到新文件名的 MultipartFile
            renamedFiles[i] = new CustomFilenameMultipartFile(originalFile, fileName);
        }
        return renamedFiles;
    }

    /**
     * 获取知识库
     *
     * @return Long
     */
    private Long getDatasetId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        SuasSuperassist suasSuperassist = superassistService.findByCreateUser(userId);
        return suasSuperassist.getSessionDatasetId();
    }

}
