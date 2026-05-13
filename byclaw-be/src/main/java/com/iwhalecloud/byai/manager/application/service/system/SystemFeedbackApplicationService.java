package com.iwhalecloud.byai.manager.application.service.system;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import org.apache.http.client.utils.DateUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.manager.domain.system.service.AttachFileService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.domain.system.service.SystemFeedbackService;
import com.iwhalecloud.byai.manager.dto.system.SystemFeedbackDTO;
import com.iwhalecloud.byai.manager.entity.system.AttachFile;
import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.IpUtil;
import jakarta.servlet.http.HttpServletRequest;

/**
 * @author he.duming
 * @date 2025-08-19 19:47:38
 * @description TODO
 */
@Service
public class SystemFeedbackApplicationService {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SystemFeedbackService systemFeedbackService;

    @Autowired
    private AttachFileService attachFileService;

    @Autowired
    private CommonFileStorage commonFileStorage;

    @Autowired
    private CommonFilePathResolver commonFilePathResolver;

    /**
     * 保存系统反馈信息
     *
     * @param systemFeedbackDTO 反馈信息
     */
    public void save(HttpServletRequest request, SystemFeedbackDTO systemFeedbackDTO) {

        SystemFeedback systemFeedback = new SystemFeedback();
        BeanUtils.copyProperties(systemFeedbackDTO, systemFeedback);
        systemFeedback.setId(sequenceService.nextVal());
        systemFeedback.setUserId(CurrentUserHolder.getCurrentUserId());
        systemFeedback.setCreateDate(new Date());
        systemFeedback.setStatus("pending");
        systemFeedback.setIpAddress(IpUtil.getIpAddress(request));
        systemFeedback.setDeviceInfo(request.getHeader("User-Agent"));
        systemFeedback.setContactInfo(CurrentUserHolder.getEmail());
        systemFeedbackService.save(systemFeedback);

        List<Long> attachFileIds = systemFeedbackDTO.getAttachFileIds();
        for (int i = 0; attachFileIds != null && i < attachFileIds.size(); i++) {
            Long attachFileId = attachFileIds.get(i);
            AttachFile attachFile = attachFileService.selectById(attachFileId);
            if (attachFile == null) {
                continue;
            }
            attachFile.setState("00A");
            attachFile.setTablePkValue(systemFeedback.getId());
            attachFileService.update(attachFile);
        }
    }

    /**
     * 上传文件反馈信息
     *
     * @param files 上传的文件
     * @return ResponseUtil
     */
    public Map<String, Object> uploadFeedbackFile(MultipartFile[] files) throws IOException {

        Map<String, Object> resultMap = new HashMap<>();

        List<Map<String, Object>> successFiles = new ArrayList<>(10);

        for (MultipartFile multipartFile : files) {

            // 提取文件信息
            String contentType = multipartFile.getContentType();
            String fileName = multipartFile.getOriginalFilename();
            String fileLocation = "/" + CurrentUserHolder.getCurrentUserCode() + "/" + fileName;
            byte[] bytes = multipartFile.getBytes();

            commonFileStorage.write(commonFilePathResolver.feedback(fileLocation), bytes, contentType);

            // 保存文件信息
            Long fileId = sequenceService.nextVal();
            AttachFile attachFile = new AttachFile();
            attachFile.setAttachFileId(fileId);
            attachFile.setFileName(fileName);
            attachFile.setFileType(contentType);
            attachFile.setFileLocation(fileLocation);
            attachFile.setSourceFileId(fileId);
            attachFile.setTableName("byai_system_feedback");
            attachFile.setTablePkName("id");
            attachFile.setTableFieldName("id");
            attachFile.setCreateDate(new Date());
            attachFile.setCreateUserId(CurrentUserHolder.getCurrentUserId());
            attachFileService.save(attachFile);

            // 设置文件返回属性
            Map<String, Object> objectMap = new HashMap<>();
            objectMap.put("attachFileId", attachFile.getAttachFileId());
            objectMap.put("fileId", attachFile.getAttachFileId());
            objectMap.put("fileName", attachFile.getFileName());
            objectMap.put("tags", "feedback");
            objectMap.put("uploadDate", DateUtils.formatDate(attachFile.getCreateDate()));
            successFiles.add(objectMap);
        }

        resultMap.put("successFiles", successFiles);
        return resultMap;
    }

}
