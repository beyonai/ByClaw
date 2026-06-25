package com.iwhalecloud.byai.state.application.service.dataset;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * OpenClaw 生成文档入知识库的应用服务。
 */
@Service
public class OpenClawKnowledgeDocumentService {

    public static final String BUILD_KNOWLEDGE_SUCCESS = "build knowledge success";

    private static final int DOC_NAME_MAX_LENGTH = 120;

    private static final DateTimeFormatter DOC_NAME_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    private final Logger logger = LoggerFactory.getLogger(OpenClawKnowledgeDocumentService.class);

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    public String buildKnowledgeFromDoc(Long resourceId, String directoryPath, String docName, String doc,
        String language) throws IOException {
        if (resourceId == null) {
            throw new IllegalArgumentException("resourceId is required");
        }
        if (StringUtils.isBlank(doc)) {
            throw new IllegalArgumentException("doc is required");
        }

        String normalizedDirectoryPath = normalizeDocDirectoryPath(directoryPath);
        String resolvedDocName = resolveDocName(docName);
        MultipartFile multipartFile = new MultipartFileUtil("files", resolvedDocName, "text/markdown",
            doc.getBytes(StandardCharsets.UTF_8));

        logger.info("OpenClaw文档入库 resourceId={}, directoryPath={}, docName={}, language={}", resourceId,
            normalizedDirectoryPath, resolvedDocName, language);
        UploadResult uploadResult = datasetApplicationService.uploadFiles(new MultipartFile[] {multipartFile},
            resourceId, normalizedDirectoryPath, resolvedDocName, Boolean.TRUE, Boolean.FALSE);

        DatasetBuild datasetBuild = new DatasetBuild();
        datasetBuild.setResourceId(resourceId);
        datasetBuild.setDirectoryPath(resolveUploadedFilePath(uploadResult, normalizedDirectoryPath, resolvedDocName));
        datasetApplicationService.build(datasetBuild);
        return BUILD_KNOWLEDGE_SUCCESS;
    }

    private String resolveDocName(String docName) {
        String resolvedDocName = StringUtils.trimToEmpty(docName);
        if (StringUtils.isBlank(resolvedDocName)) {
            resolvedDocName = "openclaw-doc-" + DOC_NAME_TIME_FORMATTER.format(LocalDateTime.now()) + ".md";
        }
        resolvedDocName = resolvedDocName.replaceAll("[\\\\/]+", "-").replaceAll("[\\r\\n\\t]+", " ").trim()
            .replaceAll("\\s+", "-").replaceAll("[^\\p{L}\\p{N}._-]+", "-")
            .replaceAll("-+", "-").replaceAll("^-+|-+$", "");
        if (StringUtils.isBlank(resolvedDocName)) {
            resolvedDocName = "openclaw-doc-" + DOC_NAME_TIME_FORMATTER.format(LocalDateTime.now()) + ".md";
        }
        if (!StringUtils.endsWithIgnoreCase(resolvedDocName, ".md")
            && !StringUtils.endsWithIgnoreCase(resolvedDocName, ".markdown")) {
            resolvedDocName = resolvedDocName + ".md";
        }
        return truncateDocName(resolvedDocName);
    }

    private String truncateDocName(String docName) {
        if (docName.length() <= DOC_NAME_MAX_LENGTH) {
            return docName;
        }
        String extension = StringUtils.endsWithIgnoreCase(docName, ".markdown") ? ".markdown" : ".md";
        String baseName = docName.substring(0, docName.length() - extension.length());
        return StringUtils.substring(baseName, 0, DOC_NAME_MAX_LENGTH - extension.length()) + extension;
    }

    private String normalizeDocDirectoryPath(String directoryPath) {
        String normalizedPath = StringUtils.trimToEmpty(directoryPath).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalizedPath) || "/".equals(normalizedPath)) {
            return "/";
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        normalizedPath = StringUtils.removeEnd(normalizedPath, "/");
        for (String pathPart : normalizedPath.split("/")) {
            if ("..".equals(pathPart)) {
                throw new IllegalArgumentException("directoryPath is invalid");
            }
        }
        return normalizedPath;
    }

    private String resolveUploadedFilePath(UploadResult uploadResult, String directoryPath, String docName) {
        if (uploadResult != null && uploadResult.getUploadItems() != null) {
            for (UploadItem uploadItem : uploadResult.getUploadItems()) {
                if (uploadItem != null && StringUtils.isNotBlank(uploadItem.getFilePath())) {
                    return uploadItem.getFilePath();
                }
            }
        }
        return "/".equals(directoryPath) ? "/" + docName : directoryPath + "/" + docName;
    }
}
