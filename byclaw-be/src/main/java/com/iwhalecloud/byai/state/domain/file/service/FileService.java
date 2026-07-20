package com.iwhalecloud.byai.state.domain.file.service;

import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.file.FilesMapper;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import feign.Request;
import feign.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-01-03 22:27:15
 */
@Service
public class FileService {

    private static final Logger logger = LoggerFactory.getLogger(FileService.class);

    @Autowired
    private FilesMapper filesMapper;

    @Autowired
    private FilesApplicationService filesApplicationService;

    /**
     * 保存文件
     *
     * @param files 文件信息
     */
    public void save(Files files) {
        filesMapper.insert(files);
    }

    /**
     * API-01 - 上传文件 上传一个或多个文件到指定会话，支持为每个文件附加多个标签
     *
     * @param files 上传的文件数据
     * @param tags 文件标签，JSON格式的字符串数组
     * @param chatId 会话ID
     * @param projectId 项目ID
     * @param isTemporary 是否为临时文档
     * @return KnowledgeResponse
     */
    public KnowledgeResponse<Map<String, Object>> uploadFiles(MultipartFile[] files, List<String> tags, Long chatId,
        Long projectId, Boolean isTemporary) {
        return null;
    }

    /**
     * API-03 - 按标签获取文件 在指定会话下，根据标签查询匹配的文件
     *
     * @param request 包含chatId、tags、matchMode的请求参数
     * @return KnowledgeResponse
     */
    public KnowledgeResponse<Map<String, Object>> searchFilesByTags(Map<String, Object> request) {
        return null;
    }

    /**
     * API-04 - 下载文件 下载指定文件的原始内容
     *
     * @param openFileDownload 文件下载请求
     * @return feign Response 包含文件流
     */
    public Response downloadFiles(OpenFileDownloadDTO openFileDownload) {
        Long fileId = openFileDownload.getFileId();
        try {
            Files file = filesMapper.selectById(fileId);
            if (file == null) {
                logger.error("文件不存在 - fileId: {}", fileId);
                return null;
            }

            String fileUrl = file.getFileUrl();
            String bucketName = UriComponentsBuilder.fromUriString(fileUrl).build().getQueryParams()
                .getFirst("bucketName");
            String filePath = UriComponentsBuilder.fromUriString(fileUrl).build().getQueryParams().getFirst("filePath");

            InputStream inputStream = filesApplicationService.openCommonFileInputStream(bucketName, filePath);

            String fileName = file.getFileName() != null ? file.getFileName() : "file";
            String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8);
            Map<String, java.util.Collection<String>> headers = new HashMap<>();
            headers.put("Content-Disposition", Collections.singletonList("attachment;filename=" + encodedFileName));
            headers.put("Content-Type", Collections.singletonList("application/octet-stream"));
            return Response.builder().status(200).reason("OK").headers(headers).body(inputStream, null)
                .request(Request.create(Request.HttpMethod.GET, "/files/download?fileId=" + fileId,
                    Collections.emptyMap(), null, null, null))
                .build();
        }
        catch (Exception e) {
            logger.error("下载文件失败 - fileId: {}, error: {}", fileId, e.getMessage(), e);
            return null;
        }
    }

    /**
     * API-07 - 批量添加标签 批量为多个文件添加标签
     *
     * @param request 批量标签添加请求，包含文件ID和标签信息
     * @return KnowledgeResponse
     */
    public KnowledgeResponse<List<Map<String, Object>>> addFileTagsBatch(Map<String, Object> request) {
        return null;
    }

}
