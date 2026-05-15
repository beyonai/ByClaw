package com.iwhalecloud.byai.manager.application.service.files;

import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.file.UploadFilesRespDto;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDelDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileMetaDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileQueryDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileTag;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileTagDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.RebuildData;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * @author he.duming
 * @date 2026-01-02 14:16:52
 * @description TODO
 */
@Service
public class FilesApplicationService {

    private Logger logger = LoggerFactory.getLogger(FilesApplicationService.class);

    @Autowired
    private FilesService filesService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private FileIngressService fileIngressService;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private CommonFileStorage commonFileStorage;

    @Autowired
    private CommonFilePathResolver commonFilePathResolver;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    /**
     * 上传文件到指定会话
     *
     * @param multipartFiles 上传的文件数组
     * @param tags 文件标签列表
     * @param chatId 会话ID
     * @param projectId 项目ID
     * @param isTemporary 是否为临时文件
     * @return successFiles / failedFiles
     */
    public Map<String, Object> uploadFiles(MultipartFile[] multipartFiles, List<String> tags, Long chatId,
        Long projectId, Boolean isTemporary) {

        if (projectId == null) {
            projectId = systemConfigService.getLongParamValueByCode(Constants.AGENT_SPACE_ID);
        }

        List<UploadFilesRespDto> successFiles = new ArrayList<>();
        List<UploadFilesRespDto> failedFiles = new ArrayList<>();
        Map<String, Object> resultMap = new HashMap<>();
        resultMap.put("successFiles", successFiles);
        resultMap.put("failedFiles", failedFiles);

        for (MultipartFile multipartFile : multipartFiles) {
            FileStorageContext fileStorageContext = FileStorageContext.chatFile(CurrentUserHolder.getCurrentUserId());
            FileMetadata fileMetadata = fileIngressService.uploadFile(multipartFile, fileStorageContext);
            Files files = new Files();
            files.setLength(multipartFile.getSize());
            files.setFileId(sequenceService.nextVal());
            files.setFileName(multipartFile.getOriginalFilename());
            files.setContentType(multipartFile.getContentType());
            files.setFileSystemType(fileMetadata.getStorageType());
            files.setFileUrl(fileMetadata.getFileUrl());
            files.setFileType(fileMetadata.getFileType());
            files.setFileMd5(fileMetadata.getFileMd5());
            files.setUploadDate(new Date());
            files.setCreateBy(CurrentUserHolder.getCurrentUserId());
            files.setTags(StringUtils.join(tags, ","));
            files.setChatId(chatId);
            files.setProjectId(projectId);
            files.setFileCollectId(-1L);
            filesService.save(files);
            UploadFilesRespDto uploadFilesRespDto = this.transformToUploadFilesRespDto(files);
            successFiles.add(uploadFilesRespDto);
        }

        return resultMap;
    }

    /**
     * 构建成功文件信息返回
     *
     * @param files 文件内容
     * @return UploadFilesRespDto
     */
    private UploadFilesRespDto transformToUploadFilesRespDto(Files files) {
        UploadFilesRespDto uploadFilesRespDto = new UploadFilesRespDto();
        uploadFilesRespDto.setFileId(files.getFileId());
        uploadFilesRespDto.setFileName(files.getFileName());
        uploadFilesRespDto.setTags(files.getTags());
        uploadFilesRespDto.setFileUrl(files.getFileUrl());
        uploadFilesRespDto.setDatasetId(files.getDatasetId());
        uploadFilesRespDto.setUploadDate(files.getUploadDate());
        return uploadFilesRespDto;
    }

    /**
     * 按标签查询文件（调用前由 Controller 完成 chatId、matchMode 校验）
     *
     * @param openFileQueryDTO 查询参数
     * @return 含 files 列表的 Map
     */
    public Map<String, Object> queryFiles(OpenFileQueryDTO openFileQueryDTO) {

        Long chatId = openFileQueryDTO.getChatId();
        String tags = openFileQueryDTO.getTags();
        String matchMode = openFileQueryDTO.getMatchMode();

        List<UploadFilesRespDto> files = filesService.selectByMatchTags(chatId, tags, matchMode);
        Map<String, Object> resultMap = new HashMap<>();
        resultMap.put("files", files);
        return resultMap;
    }

    /**
     * 下载文件
     *
     * @param response 响应流
     * @param fileId 文件标识
     */
    public void downloadFiles(HttpServletResponse response, @RequestParam("fileId") Long fileId) {

        try {
            Files files = filesService.findById(fileId);

            InputStream inputStream = fileIngressService.downloadFile(files.getFileUrl());

            // 设置ContentType，响应内容为二进制数据流，编码为utf-8，此处设定的编码是文件内容的编码
            response.setContentType(MediaType.APPLICATION_OCTET_STREAM_VALUE);
            // 以（Content-Disposition: attachment; filename="filename.jpg"）格式设定默认文件名，设定utf编码，此处的编码是文件名的编码，使能正确显示中文文件名
            String contentDisposition = "attachment;filename=" + URLEncoder.encode(files.getFileName(), "utf-8");
            response.setHeader("Content-Disposition", contentDisposition);
            IOUtils.copy(inputStream, response.getOutputStream());
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 查看文件元信息
     *
     * @param openFileMetaDTO 元数据查询参数
     * @return 文件元信息
     */
    public UploadFilesRespDto queryFileMeta(OpenFileMetaDTO openFileMetaDTO) {

        Files files = filesService.findById(openFileMetaDTO.getFileId());
        return this.transformToUploadFilesRespDto(files);
    }

    /**
     * 删除文件；当 fileIds 为空时返回 {@code null}，由 Controller 转为无 data 的成功响应
     *
     * @param openFileDelDTO 删除参数
     * @return successFileIds / failedFileIds
     */
    public Map<String, Object> deleteFiles(OpenFileDelDTO openFileDelDTO) {

        List<Long> fileIds = openFileDelDTO.getFileIds();
        if (ListUtil.isEmpty(fileIds)) {
            return null;
        }

        List<Long> successFileIds = new ArrayList<>();
        List<Long> failedFileIds = new ArrayList<>();

        Map<String, Object> resultMap = new HashMap<>();
        resultMap.put("successFileIds", successFileIds);
        resultMap.put("failedFileIds", failedFileIds);

        List<Files> filesList = filesService.findByIds(fileIds);

        for (Files files : filesList) {
            try {

                fileIngressService.deleteFile(files.getFileUrl());

                filesService.remove(files.getFileId());

                successFileIds.add(files.getFileId());
            }
            catch (Exception e) {
                logger.error("文件[{}] 删除失败: {}", files.getFileName(), e.getMessage(), e);
                failedFileIds.add(files.getFileId());
            }
        }

        return resultMap;
    }

    /**
     * 批量添加文件标签（调用前由 Controller 校验 files 非空）
     *
     * @param openFileTagDTO 标签添加参数
     * @return 更新后的文件信息列表
     */
    public List<UploadFilesRespDto> addFileTags(OpenFileTagDTO openFileTagDTO) {

        Map<Long, String> tagMap = this.buildTagMap(openFileTagDTO.getFiles());

        List<Files> filesList = filesService.findByIds(tagMap.keySet());
        for (Files files : filesList) {
            String addTags = tagMap.get(files.getFileId());
            if (StringUtils.isEmpty(addTags)) {
                continue;
            }

            Set<String> addTagsSet = Arrays.stream(addTags.split(",")).collect(Collectors.toSet());
            String tags = files.getTags();
            if (StringUtils.isNotEmpty(tags)) {
                addTagsSet.addAll(Arrays.asList(tags.split(",")));
            }
            files.setTags(String.join(",", addTagsSet));

            filesService.updateById(files);
        }

        return filesList.stream().map(this::transformToUploadFilesRespDto).collect(Collectors.toList());
    }

    /**
     * 批量删除文件标签（调用前由 Controller 校验 files 非空）
     *
     * @param openFileTagDTO 标签删除参数
     * @return 更新后的文件信息列表
     */
    public List<UploadFilesRespDto> deleteFileTags(OpenFileTagDTO openFileTagDTO) {

        Map<Long, String> tagMap = this.buildTagMap(openFileTagDTO.getFiles());

        List<Files> filesList = filesService.findByIds(tagMap.keySet());
        for (Files files : filesList) {
            String delTags = tagMap.get(files.getFileId());
            String tags = files.getTags();
            if (StringUtils.isEmpty(delTags) || StringUtils.isEmpty(tags)) {
                continue;
            }
            Set<String> delTagsSet = Arrays.stream(delTags.split(",")).collect(Collectors.toSet());
            Set<String> tagsSet = Arrays.stream(tags.split(",")).collect(Collectors.toSet());
            tagsSet.removeAll(delTagsSet);
            if (!tagsSet.isEmpty()) {
                files.setTags(String.join(",", tagsSet));
            }
            else {
                files.setTags("");
            }
            filesService.updateById(files);
        }

        return filesList.stream().map(this::transformToUploadFilesRespDto).collect(Collectors.toList());
    }

    /**
     * 构建标签集合
     *
     * @param openFileTags 标签集合
     * @return Map<Long, String>
     */
    private Map<Long, String> buildTagMap(List<OpenFileTag> openFileTags) {
        Map<Long, String> tagMap = new HashMap<Long, String>(openFileTags.size());
        for (OpenFileTag openFileTag : openFileTags) {
            tagMap.put(openFileTag.getFileId(), openFileTag.getTags());
        }
        return tagMap;
    }

    /**
     * @param multipartFiles 文件标识
     * @param datasetId 知识库标识
     * @param fileCollectId 目录标识
     * @param build 是否自动构建上传的文件
     * @return 已持久化的文件实体列表
     */
    public List<Files> preUploadFile(MultipartFile[] multipartFiles, Long datasetId, Long fileCollectId,
        Boolean build) {

        List<Files> filesList = new ArrayList<>();
        for (MultipartFile multipartFile : multipartFiles) {
            Long fileId = sequenceService.nextVal();

            FileStorageContext fileStorageContext = FileStorageContext.datasetFile(datasetId, fileId);
            FileMetadata fileMetadata = fileIngressService.uploadFile(multipartFile, fileStorageContext);
            Files files = new Files();
            files.setLength(multipartFile.getSize());
            files.setFileId(fileId);
            files.setFileName(multipartFile.getOriginalFilename());
            files.setConvertFileName(multipartFile.getOriginalFilename());
            files.setContentType(multipartFile.getContentType());
            files.setFileSystemType(fileMetadata.getStorageType());
            files.setFileUrl(fileMetadata.getFileUrl());
            files.setFileType(fileMetadata.getFileType());
            files.setFileMd5(fileMetadata.getFileMd5());
            files.setUploadDate(new Date());
            files.setCreateBy(CurrentUserHolder.getCurrentUserId());
            files.setDatasetType("4");
            files.setDatasetId(datasetId);
            files.setFileCollectId(fileCollectId != null ? fileCollectId : -1L);
            files.setProjectId(systemConfigService.getLongParamValueByCode(Constants.AGENT_SPACE_ID));
            filesService.save(files);

            // 添加到返回结果集
            filesList.add(files);
        }

        return filesList;
    }

    /**
     * 上传图标
     *
     * @param multipartFile 文件
     */
    public Files uploadIcon(MultipartFile multipartFile) throws IOException {

        // 提取文件信息
        String contentType = multipartFile.getContentType();
        String fileName = multipartFile.getOriginalFilename();
        String userCode = CurrentUserHolder.getCurrentUserCode();
        String filePath = "/" + userCode + "/" + DateUtils.formatDate(new Date(), DateUtils.COMPACT_DATE_TIME_FORMAT)
            + "/" + fileName;

        commonFileStorage.write(commonFilePathResolver.icon(filePath), multipartFile.getBytes(), contentType);

        // 替换请求地址
        String fileUrl = "/commonFile/preview?style=minio&bucketName={bucketName}&filePath={filePath}";
        fileUrl = fileUrl.replace("{bucketName}", Constants.BUCKET_NAME_ICON).replace("{filePath}", filePath);

        Files byaiFiles = new Files();
        byaiFiles.setFileId(sequenceService.nextVal());
        byaiFiles.setFileName(fileName);
        byaiFiles.setConvertFileName(fileName);
        byaiFiles.setContentType(contentType);
        byaiFiles.setFileType(StringUtil.getFileSuffix(fileName));
        byaiFiles.setCreateBy(CurrentUserHolder.getCurrentUserId());
        byaiFiles.setUploadDate(new Date());
        byaiFiles.setCompleteTime(new Date());
        byaiFiles.setFileSystemType(StorageType.MINIO);
        byaiFiles.setFileUrl(fileUrl);
        filesService.save(byaiFiles);

        return byaiFiles;
    }

    /**
     * 预览文件
     *
     * @param response 响应
     * @param style 保存类型
     * @param bucketName 桶名称
     * @param filePath 文件路径
     */
    public void preview(HttpServletResponse response, String style, String bucketName, String filePath) {
        if (StringUtil.isEmpty(bucketName)) {
            bucketName = userBucketNamingService.buildUserBucketName(CurrentUserHolder.getCurrentUserCode());
        }
        try (InputStream inputStream = openCommonFileInputStream(bucketName, filePath);) {

            // 设置ContentType，响应内容为二进制数据流，编码为utf-8，此处设定的编码是文件内容的编码
            response.setContentType(MediaType.APPLICATION_OCTET_STREAM_VALUE);

            // 以（Content-Disposition: attachment; filename="filename.jpg"）格式设定默认文件名，设定utf编码，此处的编码是文件名的编码，使能正确显示中文文件名
            String fileName = filePath;
            if (filePath.contains("/")) {
                fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
            }

            String contentDisposition = "attachment;filename=" + URLEncoder.encode(fileName, StandardCharsets.UTF_8);
            response.setHeader("Content-Disposition", contentDisposition);
            IOUtils.copy(inputStream, response.getOutputStream());
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 打开公共文件输入流，并兼容历史与 UserFS 路径差异。
     *
     * @author qin.guoquan
     * @date 2026-05-09 135953
     * @param bucketName 桶名称
     * @param filePath 文件路径
     * @return 输入流
     */
    private InputStream openCommonFileInputStream(String bucketName, String filePath) {
        try {
            return commonFileStorage.read(commonFilePathResolver.arbitrary(bucketName, filePath));
        }
        catch (RuntimeException primaryException) {
            if (StringUtils.isBlank(bucketName)) {
                throw primaryException;
            }
            String fallbackPath = stripBucketPrefix(filePath, bucketName);
            String userFsFallbackPath = prefixUserFsRootPath(fallbackPath);
            InputStream userFsInputStream = tryReadCommonFile(bucketName, userFsFallbackPath);
            if (userFsInputStream != null) {
                logger.warn(
                    "Common file preview fallback succeeded with UserFS root prefix, bucketName={}, filePath={}, fallbackPath={}",
                    bucketName, filePath, userFsFallbackPath);
                return userFsInputStream;
            }
            try {
                InputStream inputStream = commonFileStorage.read(commonFilePathResolver.arbitrary(null, fallbackPath));
                logger.warn(
                    "Common file preview fallback succeeded without bucket prefix, bucketName={}, filePath={}, fallbackPath={}",
                    bucketName, filePath, fallbackPath);
                return inputStream;
            }
            catch (RuntimeException fallbackException) {
                primaryException.addSuppressed(fallbackException);
                throw primaryException;
            }
        }
    }

    /**
     * 尝试读取公共文件，失败时返回空用于后续兜底路径继续尝试。
     *
     * @author qin.guoquan
     * @date 2026-05-09 135953
     * @param bucketName 桶名称
     * @param filePath 文件路径
     * @return 输入流
     */
    private InputStream tryReadCommonFile(String bucketName, String filePath) {
        try {
            return commonFileStorage.read(commonFilePathResolver.arbitrary(bucketName, filePath));
        }
        catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * 将外部会话文件路径转换为 UserFS 底层存储路径。
     *
     * @author qin.guoquan
     * @date 2026-05-09 135953
     * @param filePath 文件路径
     * @return UserFS 底层路径
     */
    private String prefixUserFsRootPath(String filePath) {
        String normalizedPath = StringUtils.defaultString(filePath).trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalizedPath) || StringUtils.equals(normalizedPath, "/")) {
            return "/by";
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        if (StringUtils.equals(normalizedPath, "/by") || normalizedPath.startsWith("/by/")) {
            return normalizedPath;
        }
        return "/by" + normalizedPath;
    }

    /**
     * 去除文件路径中可能重复携带的 bucket 前缀。
     *
     * @author qin.guoquan
     * @date 2026-05-09 135953
     * @param filePath 文件路径
     * @param bucketName 桶名称
     * @return 去除 bucket 后的文件路径
     */
    private String stripBucketPrefix(String filePath, String bucketName) {
        String normalizedPath = StringUtils.defaultString(filePath).trim().replace('\\', '/').replaceAll("/+", "/");
        String normalizedBucket = StringUtils.defaultString(bucketName).trim().replace('\\', '/').replaceAll("/+", "/");
        while (normalizedBucket.startsWith("/")) {
            normalizedBucket = normalizedBucket.substring(1);
        }
        while (normalizedBucket.endsWith("/")) {
            normalizedBucket = normalizedBucket.substring(0, normalizedBucket.length() - 1);
        }
        if (StringUtils.isBlank(normalizedBucket)) {
            return normalizedPath;
        }
        String bucketPrefix = "/" + normalizedBucket;
        if (StringUtils.equals(normalizedPath, bucketPrefix)) {
            return "/";
        }
        if (normalizedPath.startsWith(bucketPrefix + "/")) {
            return normalizedPath.substring(bucketPrefix.length());
        }
        return normalizedPath;
    }

    /**
     * 文件下载
     *
     * @param response 响应
     * @param fileId 文件标识
     */
    public void download(HttpServletResponse response, Long fileId) {

        Files files = filesService.findById(fileId);

        String fileUrl = files.getFileUrl();
        String fileName = files.getFileName();

        String bucketName = UriComponentsBuilder.fromUriString(fileUrl).build().getQueryParams().getFirst("bucketName");
        String filePath = UriComponentsBuilder.fromUriString(fileUrl).build().getQueryParams().getFirst("filePath");

        try (
            InputStream inputStream = commonFileStorage.read(commonFilePathResolver.arbitrary(bucketName, filePath));) {

            // 设置ContentType，响应内容为二进制数据流，编码为utf-8，此处设定的编码是文件内容的编码
            response.setContentType(MediaType.APPLICATION_OCTET_STREAM_VALUE);

            // 以（Content-Disposition: attachment; filename="filename.jpg"）格式设定默认文件名，设定utf编码，此处的编码是文件名的编码，使能正确显示中文文件名

            String contentDisposition = "attachment;filename=" + URLEncoder.encode(fileName, StandardCharsets.UTF_8);
            response.setHeader("Content-Disposition", contentDisposition);
            IOUtils.copy(inputStream, response.getOutputStream());
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }

    }
}
