package com.iwhalecloud.byai.state.application.service.upload;

import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.domain.chat.dto.FileUploadDto;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/** 文件空间与知识库上传入口共用的全局上传限制校验。 */
@Service
public class GlobalFileUploadValidator {

    private static final String CONFIG_CODE = "DIG_EMPLOYEE_FILE_UPLOAD_CONFIG";

    private static final long BYTES_PER_MB = 1024L * 1024L;

    private final ByaiSystemConfigService byaiSystemConfigService;

    public GlobalFileUploadValidator(ByaiSystemConfigService byaiSystemConfigService) {
        this.byaiSystemConfigService = byaiSystemConfigService;
    }

    /**
     * 在任何文件写入前检查整个批次；缺省、零值及负值不附加大小限制，恰好达到上限允许上传。
     * 这些入口只使用全局大小，不采用数字员工覆盖项，也不受聊天附件 enabled 开关影响。
     */
    public void validateSize(MultipartFile[] files) {
        validate(files, false);
    }

    /** 知识库与项目云盘同时校验本批次数量及单文件大小，恰好达到数量上限仍允许上传。 */
    public void validateKnowledgeUpload(MultipartFile[] files) {
        validate(files, true);
    }

    private void validate(MultipartFile[] files, boolean checkFileCount) {
        if (files == null || files.length == 0) {
            return;
        }
        String configValue = byaiSystemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE);
        FileUploadDto config = JSON.parseObject(configValue, FileUploadDto.class);

        // 一次读取同一份配置；数量不限不影响大小校验，大小不限也不跳过数量校验。
        long maxFileCount = config == null ? 0L : config.getMaxFileCount();
        if (checkFileCount && maxFileCount > 0 && files.length > maxFileCount) {
            throw new IllegalArgumentException(I18nUtil.get("file.upload.count.exceeded", maxFileCount, files.length));
        }
        long maxFileSizeMB = config == null ? 0L : config.getMaxFileSize();
        if (maxFileSizeMB <= 0 || maxFileSizeMB > Long.MAX_VALUE / BYTES_PER_MB) {
            return;
        }
        long maxFileSizeBytes = maxFileSizeMB * BYTES_PER_MB;
        for (MultipartFile file : files) {
            if (file != null && file.getSize() > maxFileSizeBytes) {
                double sizeMB = file.getSize() / (double) BYTES_PER_MB;
                throw new IllegalArgumentException(I18nUtil.get("file.upload.size.exceeded", maxFileSizeMB, sizeMB));
            }
        }
    }
}
