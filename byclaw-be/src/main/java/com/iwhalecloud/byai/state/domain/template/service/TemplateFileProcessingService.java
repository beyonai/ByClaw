package com.iwhalecloud.byai.state.domain.template.service;

import cn.hutool.core.date.DateUtil;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessagesCopyRequestDto;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import feign.Response;

/**
 * 模板文件处理服务
 * <p>
 * 负责处理模板会话中的文件下载、重新上传和ID映射关系构建。
 * </p>
 *
 * @author smartcloud
 * @version 1.0
 * @since 1.0
 */
@Slf4j
@Service
public class TemplateFileProcessingService {

    @Autowired
    private FileService fileService;

    @Autowired
    private AssistantChatApplicationService assistantChatApplicationService;

    /**
     * 文件ID在消息内容中的正则表达式模式 匹配JSON格式的文件ID，如 "fileId":"1485803457067106304"
     */
    private static final Pattern FILE_ID_PATTERN = Pattern.compile("\"fileId\"\\s*:\\s*\"(\\d+)\"");

    /**
     * 文件ID数组在消息内容中的正则表达式模式 匹配JSON格式的文件ID数组，如 "fileIds":["1485803457067106304"]
     */
    private static final Pattern FILE_IDS_ARRAY_PATTERN = Pattern
        .compile("\"fileIds\"\\s*:\\s*\\[\\s*\"(\\d+)\"\\s*\\]");

    /**
     * 下载文件（公共方法）
     *
     * @param fileId 文件ID
     * @return 下载响应
     * @throws BdpRuntimeException 当下载失败时抛出
     */
    public Response downloadFile(Long fileId) {
        try {
            // 下载原文件 - 使用FileService的下载文件接口
            OpenFileDownloadDTO openFileDownloadDTO = new OpenFileDownloadDTO();
            openFileDownloadDTO.setFileId(fileId);
            Response downloadResponse = fileService.downloadFiles(openFileDownloadDTO);

            // 检查下载是否成功
            if (!isDownloadSuccessful(downloadResponse, fileId)) {
                log.error("文件下载失败 - fileId: {}", fileId);
                throw new BdpRuntimeException(I18nUtil.get("template.file.download.failed", fileId));
            }

            return downloadResponse;
        }
        catch (Exception e) {
            log.error("下载文件异常 - fileId: {}, error: {}", fileId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.file.process.error", fileId, e.getMessage()));
        }
    }

    /**
     * 处理会话消息中的文件，下载并重新上传，构建文件ID映射关系
     * <p>
     * 文件会通过当前会话的上传链路重新落盘并生成新文件ID，避免模板继续引用原消息创建者的文件。
     *
     * @param messages 消息列表
     * @param sessionId 会话ID
     * @return 文件映射关系 (原文件ID -> 新文件信息)
     * @throws BdpRuntimeException 当文件处理失败时抛出
     */
    public Map<String, TemplateMessagesCopyRequestDto.FileInfo> processFilesInMessages(List<ByaiMessageHotDto> messages,
        String sessionId) {
        log.info("开始处理会话消息中的文件 - sessionId: {}, 消息数量: {}", sessionId, messages.size());

        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings = new HashMap<>();
        Map<String, Long> originalFileIds = extractFileIdsFromMessages(messages);

        if (originalFileIds.isEmpty()) {
            log.info("会话消息中未发现文件引用 - sessionId: {}", sessionId);
            return fileMappings;
        }

        log.info("发现 {} 个文件需要处理 - sessionId: {}", originalFileIds.size(), sessionId);

        for (Map.Entry<String, Long> entry : originalFileIds.entrySet()) {
            String fileIdStr = entry.getKey();
            Long fileId = entry.getValue();

            try (Response downloadResponse = this.downloadFile(fileId)) {

                String originalFileName = getFileNameFromDownloadResponse(downloadResponse, fileId);

                TemplateMessagesCopyRequestDto.FileInfo fileInfo = uploadFileViaChat(downloadResponse,
                    Long.valueOf(sessionId), originalFileName);
                if (StringUtils.isBlank(fileInfo.getFileId())) {
                    log.error("文件重新上传失败 - fileId: {}", fileId);
                    throw new BdpRuntimeException(I18nUtil.get("template.file.upload.failed", fileId));
                }

                if (StringUtils.isBlank(fileInfo.getFileName())) {
                    fileInfo.setFileName(originalFileName);
                }

                fileMappings.put(fileIdStr, fileInfo);
                log.info("文件处理成功 - 原文件ID: {}, 新文件ID: {}, 文件名: {}, 文件URL: {}", fileId, fileInfo.getFileId(),
                    fileInfo.getFileName(), fileInfo.getFileUrl());

            }
            catch (BdpRuntimeException e) {
                throw e;
            }
            catch (Exception e) {
                log.error("处理文件时发生异常 - fileId: {}, error: {}", fileId, e.getMessage(), e);
                throw new BdpRuntimeException(I18nUtil.get("template.file.process.error", fileId, e.getMessage()), e);
            }
        }

        log.info("文件处理完成 - sessionId: {}, 成功处理文件数: {}", sessionId, fileMappings.size());
        return fileMappings;
    }

    /**
     * 从消息列表中提取所有文件ID
     *
     * @param messages 消息列表
     * @return 文件ID映射 (文件ID字符串 -> 文件ID长整型)
     */
    private Map<String, Long> extractFileIdsFromMessages(List<ByaiMessageHotDto> messages) {
        Map<String, Long> fileIds = new HashMap<>();

        for (ByaiMessageHotDto message : messages) {
            if (message == null || StringUtils.isBlank(message.getMessageContent())) {
                continue;
            }

            // 从关联资源中提取文件ID（如果存在）
            if (StringUtils.isNotBlank(message.getRelatedResources())) {
                extractFileIdsFromText(message.getRelatedResources(), fileIds);
            }
        }

        return fileIds;
    }

    /**
     * 检查下载是否成功
     *
     * @param downloadResponse 下载响应
     * @param fileId 文件ID
     * @return 是否下载成功
     */
    private boolean isDownloadSuccessful(Response downloadResponse, Long fileId) {
        // 1. 检查响应对象是否为null
        if (downloadResponse == null) {
            log.error("下载响应为null - fileId: {}", fileId);
            return false;
        }

        // 2. 检查HTTP状态码
        int statusCode = downloadResponse.status();
        if (statusCode < 200 || statusCode >= 300) {
            log.error("下载HTTP状态码异常 - fileId: {}, statusCode: {}", fileId, statusCode);
            return false;
        }

        // 3. 检查响应体是否为null
        if (downloadResponse.body() == null) {
            log.error("下载响应体为null - fileId: {}", fileId);
            return false;
        }

        // 4. 检查文件内容
        return true;
    }

    /**
     * 验证文件内容是否有效
     *
     * @param downloadResponse 下载响应
     * @param fileId 文件ID
     * @return 文件内容是否有效
     */
    private boolean validateFileContent(Response downloadResponse, Long fileId) {
        try {
            // 读取文件内容
            byte[] content = downloadResponse.body().asInputStream().readAllBytes();

            // 检查内容是否为空
            if (content == null || content.length == 0) {
                log.error("下载文件内容为空 - fileId: {}", fileId);
                return false;
            }

            // 检查是否为错误页面
            if (isErrorPage(downloadResponse, content)) {
                log.error("下载返回错误页面 - fileId: {}", fileId);
                return false;
            }

            log.debug("文件下载成功 - fileId: {}, 文件大小: {} bytes", fileId, content.length);
            return true;

        }
        catch (Exception e) {
            log.error("验证文件内容失败 - fileId: {}, error: {}", fileId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * 检查是否为错误页面
     *
     * @param downloadResponse 下载响应
     * @param content 响应内容
     * @return 是否为错误页面
     */
    private boolean isErrorPage(Response downloadResponse, byte[] content) {
        try {
            // 检查Content-Type头
            Collection<String> contentTypeCollection = downloadResponse.headers().get("Content-Type");
            if (contentTypeCollection == null || contentTypeCollection.isEmpty()) {
                return false;
            }

            String contentType = contentTypeCollection.iterator().next();
            if (contentType == null || !contentType.contains("text/html")) {
                return false;
            }

            // 如果返回的是HTML且内容很短，可能是错误页面
            if (content.length < 1024) {
                String contentStr = new String(content, StandardCharsets.UTF_8);
                return contentStr.contains("error") || contentStr.contains("Error") || contentStr.contains("404")
                    || contentStr.contains("500");
            }

            return false;

        }
        catch (Exception e) {
            log.warn("检查错误页面失败 - error: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 从下载响应中获取文件名
     *
     * @param downloadResponse 下载响应
     * @return 文件名，如果无法获取则返回null
     */
    private String getFileNameFromDownloadResponse(Response downloadResponse, Long fileId) {
        try {
            // 尝试从Content-Disposition头中获取文件名
            Collection<String> contentDispositionCollection = downloadResponse.headers().get("Content-Disposition");
            String contentDisposition = (contentDispositionCollection != null
                && !contentDispositionCollection.isEmpty()) ? contentDispositionCollection.iterator().next() : null;
            if (StringUtils.isNotBlank(contentDisposition)) {
                // 解析 Content-Disposition: attachment; filename="example.png"
                if (contentDisposition.contains("filename=")) {
                    String fileName = contentDisposition.substring(contentDisposition.indexOf("filename=") + 9);
                    // 移除引号
                    fileName = fileName.replaceAll("\"", "").trim();
                    if (StringUtils.isNotBlank(fileName)) {
                        log.debug("从Content-Disposition获取文件名: {}", fileName);
                        return URLDecoder.decode(fileName, StandardCharsets.UTF_8);
                    }
                }
            }

            // 如果无法从响应头获取，返回null，让调用方使用默认文件名生成逻辑
            log.debug("无法从下载响应中获取文件名");
            return null;
        }
        catch (Exception e) {
            log.warn("获取文件名失败: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 从文本中提取文件ID 支持两种格式： 1. "fileId":"1485803457067106304" 2. "fileIds":["1485803457067106304"]
     *
     * @param text 要搜索的文本
     * @param fileIds 文件ID映射表
     */
    private void extractFileIdsFromText(String text, Map<String, Long> fileIds) {
        if (StringUtils.isBlank(text)) {
            return;
        }

        // 匹配 "fileId":"1485803457067106304" 格式
        Matcher fileIdMatcher = FILE_ID_PATTERN.matcher(text);
        while (fileIdMatcher.find()) {
            String fileIdStr = fileIdMatcher.group(1);
            try {
                Long fileId = Long.parseLong(fileIdStr);
                fileIds.put(fileIdStr, fileId);
                log.debug("从文本中提取到文件ID - fileId: {}", fileId);
            }
            catch (NumberFormatException e) {
                log.warn("无效的文件ID格式 - fileIdStr: {}", fileIdStr);
            }
        }

        // 匹配 "fileIds":["1485803457067106304"] 格式
        Matcher fileIdsArrayMatcher = FILE_IDS_ARRAY_PATTERN.matcher(text);
        while (fileIdsArrayMatcher.find()) {
            String fileIdStr = fileIdsArrayMatcher.group(1);
            try {
                Long fileId = Long.parseLong(fileIdStr);
                fileIds.put(fileIdStr, fileId);
                log.debug("从文本数组中提取到文件ID - fileId: {}", fileId);
            }
            catch (NumberFormatException e) {
                log.warn("无效的文件ID格式 - fileIdStr: {}", fileIdStr);
            }
        }
    }

    private TemplateMessagesCopyRequestDto.FileInfo uploadFileViaChat(Response downloadResponse, Long sessionId,
        String originalFileName) {
        try {
            MultipartFile multipartFile = createMultipartFileFromResponse(downloadResponse,
                DateUtil.current() + "_" + originalFileName);

            SessionUploadResult uploadResult = assistantChatApplicationService.uploadFiles(
                new MultipartFile[] {multipartFile}, sessionId, null, null);

            if (uploadResult == null || uploadResult.getUploadItems() == null
                || uploadResult.getUploadItems().isEmpty()) {
                log.error("文件上传失败，无返回结果 - sessionId: {}", sessionId);
                throw new BdpRuntimeException(I18nUtil.get("template.file.upload.failed", sessionId, "无返回结果"));
            }

            UploadItem item = uploadResult.getUploadItems().get(0);
            if (item == null || item.getFileId() == null) {
                log.error("文件上传成功但无文件ID - sessionId: {}", sessionId);
                throw new BdpRuntimeException(I18nUtil.get("template.file.upload.no.file.id", sessionId));
            }
            TemplateMessagesCopyRequestDto.FileInfo fileInfo = new TemplateMessagesCopyRequestDto.FileInfo();
            fileInfo.setFileId(String.valueOf(item.getFileId()));
            fileInfo.setFileName(item.getFileName());
            fileInfo.setFileUrl(item.getFileUrl());
            fileInfo.setFileSize(multipartFile.getSize());
            return fileInfo;
        }
        catch (Exception e) {
            log.error("文件上传异常 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.file.upload.error", sessionId, e.getMessage()));
        }
    }

    /**
     * 从下载响应创建MultipartFile对象
     *
     * @param downloadResponse 下载响应
     * @param originalFileName 原始文件名
     * @return MultipartFile对象
     * @throws IOException 当创建失败时抛出
     */
    private MultipartFile createMultipartFileFromResponse(Response downloadResponse, String originalFileName)
        throws IOException {
        byte[] fileContent = downloadResponse.body().asInputStream().readAllBytes();
        Collection<String> contentTypeCollection = downloadResponse.headers().get("Content-Type");
        final String contentType = (contentTypeCollection != null && !contentTypeCollection.isEmpty())
            ? contentTypeCollection.iterator().next()
            : "application/octet-stream";

        // 使用原始文件名，如果没有则根据内容类型生成
        String fileName = StringUtils.isNotBlank(originalFileName) ? originalFileName : generateFileName(contentType);

        return new MultipartFile() {
            @Override
            public String getName() {
                return "file";
            }

            @Override
            public String getOriginalFilename() {
                return fileName;
            }

            @Override
            public String getContentType() {
                return contentType;
            }

            @Override
            public boolean isEmpty() {
                return fileContent == null || fileContent.length == 0;
            }

            @Override
            public long getSize() {
                return fileContent != null ? fileContent.length : 0;
            }

            @Override
            public byte[] getBytes() throws IOException {
                return fileContent;
            }

            @Override
            public java.io.InputStream getInputStream() throws IOException {
                return new ByteArrayInputStream(fileContent);
            }

            @Override
            public void transferTo(java.io.File dest) throws IOException, IllegalStateException {
                throw new UnsupportedOperationException(
                    I18nUtil.get("template.file.processing.transfer.to.not.supported"));
            }
        };
    }

    /**
     * 根据内容类型生成文件名
     *
     * @param contentType 内容类型
     * @return 文件名
     */
    private String generateFileName(String contentType) {
        String extension = "bin";

        if (contentType != null) {
            if (contentType.contains("image/jpeg") || contentType.contains("image/jpg")) {
                extension = "jpg";
            }
            else if (contentType.contains("image/png")) {
                extension = "png";
            }
            else if (contentType.contains("image/gif")) {
                extension = "gif";
            }
            else if (contentType.contains("application/pdf")) {
                extension = "pdf";
            }
            else if (contentType.contains("text/plain")) {
                extension = "txt";
            }
            else if (contentType.contains("application/msword")) {
                extension = "doc";
            }
            else if (contentType.contains("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
                extension = "docx";
            }
            else if (contentType.contains("application/vnd.ms-excel")) {
                extension = "xls";
            }
            else if (contentType.contains("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
                extension = "xlsx";
            }
        }

        return "template_file_" + System.currentTimeMillis() + "." + extension;
    }

}
