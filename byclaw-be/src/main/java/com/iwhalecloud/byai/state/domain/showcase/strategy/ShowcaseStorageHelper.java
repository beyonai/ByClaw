package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.log.exception.KnowledgeRuntimeExcepion;
import lombok.extern.slf4j.Slf4j;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 成果存储辅助类，负责将文件上传至对象存储并返回访问地址。
 */
@Slf4j
@Component
public class ShowcaseStorageHelper {

    private final FileService fileService;

    private final ByaiSystemConfigService byaiSystemConfigService;

    public ShowcaseStorageHelper(FileService fileService, ByaiSystemConfigService byaiSystemConfigService) {
        this.fileService = fileService;
        this.byaiSystemConfigService = byaiSystemConfigService;
    }

    /**
     * 上传文件至对象存储。
     *
     * @param showcase 成果实体
     * @param payload 下载得到的文件载体
     * @return 包含对象存储访问地址的载体
     */
    public ShowcaseStoragePayload upload(ByaiShowcase showcase, ShowcaseStoragePayload payload) {
        if (isPayloadInvalid(showcase, payload)) {
            return ShowcaseStoragePayload.empty();
        }
        String contentType = StringUtils.defaultIfBlank(payload.getMediaType(), "application/octet-stream");
        String originalFileName = determineFileName(showcase, payload);
        // 如果文件名是URL编码的（如 %E5%BD%95%E9%9F%B3%E8%AE%B0%E5%BD%951765628381893），先解码
        // 确保整个流程中使用的都是未编码的原始文件名
        String decodedFileName = decodeFileName(originalFileName);
        MultipartFile multipartFile = createMultipartFile(payload, contentType, decodedFileName);

        KnowledgeResponse<Map<String, Object>> response = fileService.uploadFiles(new MultipartFile[] {
            multipartFile
        }, buildUploadTags(showcase), showcase.getSessionId(), resolveProjectId(), false);
        if (!Constants.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new KnowledgeRuntimeExcepion(response.getResultMsg());
        }

        // 统一使用解码后的文件名传递给后续方法，确保保存的文件名也是未编码的
        ShowcaseStoragePayload successPayload = buildPayloadFromResponse(showcase, decodedFileName, contentType,
            response.getResultObject());
        if (successPayload != null) {
            return successPayload;
        }

        return buildFallbackPayload(showcase, decodedFileName, contentType);
    }

    private boolean isPayloadInvalid(ByaiShowcase showcase, ShowcaseStoragePayload payload) {
        if (payload == null || payload.isEmpty()) {
            log.warn("成果上传内容为空，跳过上传流程 showcaseId={}", showcase.getId());
            return true;
        }
        byte[] fileContent = payload.getFileContent();
        if (fileContent == null || fileContent.length == 0) {
            log.warn("成果上传内容为空字节数组，跳过上传流程 showcaseId={}", showcase.getId());
            return true;
        }
        return false;
    }

    private MultipartFile createMultipartFile(ShowcaseStoragePayload payload, String contentType,
        String originalFileName) {
        return new MultipartFileUtil(originalFileName, originalFileName, contentType, payload.getFileContent());
    }

    private String convertSessionId(Long sessionId) {
        return sessionId == null ? null : sessionId.toString();
    }

    private ShowcaseStoragePayload buildPayloadFromResponse(ByaiShowcase showcase, String originalFileName,
        String contentType, Map<String, Object> result) {
        if (result == null) {
            return null;
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> successFiles = (List<Map<String, Object>>) result.get("successFiles");
        if (CollectionUtils.isEmpty(successFiles)) {
            return null;
        }
        Map<String, Object> first = successFiles.get(0);
        // 如果响应中的文件名不为空，使用响应中的文件名（可能是编码的，需要解码）
        String responseFileName = asString(first.get("fileName"));
        if (StringUtils.isNotBlank(responseFileName)) {
            // 对响应中的文件名进行解码，确保保存的是未编码的原始文件名
            originalFileName = decodeFileName(responseFileName);
        }
        String fileId = asString(first.get("fileId"));
        String fileCode = asString(first.get("fileCode"));
        String fileUrl = chooseUrl(first);
        if (StringUtils.isBlank(fileUrl)) {
            return null;
        }
        log.info("成果文件上传成功 showcaseId={} url={} fileId={} fileCode={} fileName={}", showcase.getId(), fileUrl, fileId,
            fileCode, originalFileName);
        return ShowcaseStoragePayload.withObjectUrl(fileUrl, originalFileName, contentType, fileId, fileCode);
    }

    private ShowcaseStoragePayload buildFallbackPayload(ByaiShowcase showcase, String originalFileName,
        String contentType) {
        log.warn("成果文件上传成功但未返回有效URL，使用原有地址 showcaseId={}", showcase.getId());
        String fallbackUrl = StringUtils.isNotBlank(showcase.getUrl()) ? showcase.getUrl() : showcase.getContent();
        return ShowcaseStoragePayload.withObjectUrl(fallbackUrl, originalFileName, contentType, showcase.getFileId(),
            showcase.getFileCode());
    }

    private Long resolveProjectId() {
        String projectIdValue = byaiSystemConfigService
            .getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID);
        try {
            return Long.parseLong(projectIdValue);
        }
        catch (NumberFormatException e) {
            log.error("Invalid project id value: {}", projectIdValue, e);
            throw new RuntimeException(I18nUtil.get("showcase.storage.helper.invalid.project.id.config"), e);
        }
    }

    private String determineFileName(ByaiShowcase showcase, ShowcaseStoragePayload payload) {
        String fileName = payload.getFileName();
        if (StringUtils.isNotBlank(fileName)) {
            return fileName;
        }
        if (StringUtils.isNotBlank(showcase.getName())) {
            return showcase.getName();
        }
        if (showcase.getId() != null) {
            return "showcase_" + showcase.getId();
        }
        return "showcase";
    }

    private List<String> buildUploadTags(ByaiShowcase showcase) {
        List<String> tags = new ArrayList<>();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId != null) {
            // 记录showcase
            tags.add("SC_" + currentUserId);
        }
        if (null != showcase.getSessionId()) {
            tags.add("SE_" + showcase.getSessionId());
        }
        return tags;
    }

    private String chooseUrl(Map<String, Object> fileInfo) {
        String fileUrl = asString(fileInfo.get("fileUrl"));
        if (StringUtils.isNotBlank(fileUrl)) {
            return fileUrl;
        }
        return asString(fileInfo.get("downloadUrl"));
    }

    private String asString(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String) {
            return (String) value;
        }
        return Objects.toString(value, null);
    }

    private String decodeFileName(String fileName) {
        if (StringUtils.isBlank(fileName)) {
            return fileName;
        }
        try {
            return URLDecoder.decode(fileName, StandardCharsets.UTF_8);
        }
        catch (Exception ex) {
            log.debug("文件名URL解码失败: {}", ex.getMessage());
            return fileName;
        }
    }
}
