package com.iwhalecloud.byai.state.domain.template.service;

import cn.hutool.core.date.DateUtil;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.common.util.UrlUtil;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessagesCopyRequestDto;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.common.feign.request.knowledge.Metadata;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.assitsant.service.SuperassistService;
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
    private SuperassistService superassistService;

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
     * 注意：文件重新上传时使用当前登录用户的datasetId，而不是原消息创建者的datasetId。 这是因为： 1. 模板会话是由当前登录用户创建的，文件应该归属于模板创建者 2.
     * 原文件可能属于不同的用户，直接使用可能导致权限问题 3. 模板的目的是让当前用户能够复用，所以文件应该存储在当前用户的知识库中
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

            // 下载原文件 - 使用公共下载方法
            try (Response downloadResponse = this.downloadFile(fileId);) {

                // 从下载响应中获取文件名（如果可用）
                String originalFileName = getFileNameFromDownloadResponse(downloadResponse, fileId);

                // 重新上传文件，使用当前登录用户的datasetId（因为模板是当前用户创建的）
                TemplateMessagesCopyRequestDto.FileInfo fileInfo = uploadFileToSession(downloadResponse, sessionId,
                    originalFileName);
                if (StringUtils.isBlank(fileInfo.getFileId())) {
                    log.error("文件重新上传失败 - fileId: {}", fileId);
                    throw new BdpRuntimeException(I18nUtil.get("template.file.upload.failed", fileId));
                }

                // 如果上传返回的文件信息中缺少某些字段，使用下载响应中的信息补充
                if (StringUtils.isBlank(fileInfo.getFileName())) {
                    fileInfo.setFileName(originalFileName);
                }
                if (fileInfo.getFileSize() == null || fileInfo.getFileSize() == 0) {
                    byte[] bodyBytes = downloadResponse.body().asInputStream().readAllBytes();
                    fileInfo.setFileSize((long) bodyBytes.length);
                }
                // fileType 现在从接口响应中获取，不需要手动设置默认值

                fileMappings.put(fileIdStr, fileInfo);
                log.info("文件处理成功 - 原文件ID: {}, 新文件ID: {}, 文件名: {}, 文件URL: {}", fileId, fileInfo.getFileId(),
                    fileInfo.getFileName(), fileInfo.getFileUrl());

            }
            catch (BdpRuntimeException e) {
                // 重新抛出业务异常
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
        // return validateFileContent(downloadResponse, fileId);
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

    /**
     * 获取用户的个人对话知识库ID
     *
     * @param userId 用户ID
     * @return 知识库ID
     */
    private Long getDatasetId(Long userId) {
        SuasSuperassist suasSuperassist = superassistService.findByCreateUser(userId);
        return suasSuperassist.getSessionDatasetId();
    }

    /**
     * 获取当前登录用户的个人对话知识库ID
     *
     * @return 知识库ID
     */
    private Long getCurrentUserDatasetId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return getDatasetId(userId);
    }

    /**
     * 将下载的文件重新上传到指定会话
     *
     * @param downloadResponse 下载响应
     * @param sessionId 会话ID
     * @param originalFileName 原始文件名
     * @return 文件信息对象
     * @throws BdpRuntimeException 当上传失败时抛出
     */
    private TemplateMessagesCopyRequestDto.FileInfo uploadFileToSession(Response downloadResponse, String sessionId,
        String originalFileName) {
        try {
            // 创建MultipartFile对象
            MultipartFile multipartFile = createMultipartFileFromResponse(downloadResponse,
                DateUtil.current() + "_" + originalFileName);

            // 使用fileService.preUploadFile上传文件
            // 参考superAssistKwCatalogApplicationService.uploadFileAndRebuild的逻辑
            // 使用当前登录用户的datasetId，因为模板是当前用户创建的
            Long datasetId = this.getCurrentUserDatasetId();

            // 构建上传文件的元数据信息
            Metadata metadata = new Metadata();
            metadata.setDatasetId(datasetId);
            metadata.setDatasetType("4"); // 4表示个人对话知识库类型
            metadata.setFileCollectId(datasetId); // 使用datasetId作为fileCollectId

            KnowledgeResponse uploadResponse = null;

            // 检查上传结果
            if (!Constants.RESPONSE_SUCCESS.equals(uploadResponse.getResultCode())) {
                log.error("文件上传失败 - sessionId: {}, response: {}", sessionId, uploadResponse.getResultMsg());
                throw new BdpRuntimeException(
                    I18nUtil.get("template.file.upload.failed", sessionId, uploadResponse.getResultMsg()));
            }

            // 从响应中提取文件信息
            TemplateMessagesCopyRequestDto.FileInfo fileInfo = extractFileInfoFromKnowledgeResponse(uploadResponse);
            if (fileInfo == null || StringUtils.isBlank(fileInfo.getFileId())) {
                log.error("文件上传成功但无法获取文件信息 - sessionId: {}, response: {}", sessionId, uploadResponse);
                throw new BdpRuntimeException(I18nUtil.get("template.file.upload.no.file.id", sessionId));
            }

            log.info("文件上传成功 - sessionId: {}, newFileId: {}, fileUrl: {}", sessionId, fileInfo.getFileId(),
                fileInfo.getFileUrl());
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

    /**
     * 从KnowledgeResponse中提取文件信息
     *
     * @param uploadResponse 上传响应
     * @return 文件信息对象，包含fileId和fileUrl
     */
    private TemplateMessagesCopyRequestDto.FileInfo extractFileInfoFromKnowledgeResponse(
        KnowledgeResponse uploadResponse) {
        try {
            // 根据preUploadFile的响应结构来解析文件信息
            Object resultObject = uploadResponse.getResultObject();
            if (resultObject instanceof List) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> resultList = (List<Map<String, Object>>) resultObject;
                if (!resultList.isEmpty()) {
                    Map<String, Object> fileInfo = resultList.get(0);
                    Object fileId = fileInfo.get("fileId");
                    Object fileUrl = fileInfo.get("fileUrl");
                    Object fileName = fileInfo.get("fileName");
                    Object fileSize = fileInfo.get("fileSize");
                    Object fileType = fileInfo.get("fileType");

                    if (fileId != null) {
                        // 构建完整的fileUrl，添加前缀
                        String fullFileUrl = "";
                        if (fileUrl != null && StringUtils.isNotBlank(fileUrl.toString())) {
                            String relativeUrl = fileUrl.toString();
                            // 如果已经是完整URL（包含http://），直接使用
                            if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
                                fullFileUrl = relativeUrl;
                            }
                            else {
                                // 否则添加前缀：chat.server.byai + chat.server.conversationService + relativeUrl
                                String completionConversationUrl = UrlUtil.getCompletionConversationUrl();
                                fullFileUrl = UrlUtil.concatUrl(completionConversationUrl, relativeUrl);
                            }
                        }

                        return TemplateMessagesCopyRequestDto.FileInfo.builder().fileId(fileId.toString())
                            .fileUrl(fullFileUrl).fileName(fileName != null ? fileName.toString() : "")
                            .fileSize(fileSize != null ? Long.valueOf(fileSize.toString()) : 0L)
                            .fileType(fileType != null ? fileType.toString() : "file") // 从接口响应中获取fileType
                            .build();
                    }
                }
            }
            log.warn("无法从KnowledgeResponse中解析文件信息 - response: {}", uploadResponse);
            return null;
        }
        catch (Exception e) {
            log.error("解析KnowledgeResponse失败 - error: {}", e.getMessage(), e);
            return null;
        }
    }
}
