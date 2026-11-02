package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserPathPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile;

/** 在用户确认后将私有文件转存项目云盘，逐文件保存结果以支持失败重试。 */
@Service
public class GroupChatPublicationUploader {
    @Value("${spring.servlet.multipart.max-file-size:2GB}")
    private String maxFileSize = "2GB";
    private final UserFS userFS;
    private final DatasetApplicationService datasets;
    private final GroupChatPendingPublicationStore store;

    public GroupChatPublicationUploader(UserFS userFS, DatasetApplicationService datasets,
        GroupChatPendingPublicationStore store) {
        this.userFS = userFS;
        this.datasets = datasets;
        this.store = store;
    }

    public List<GroupChatTaskFile> upload(ByaiGroupChatPendingPublication pending, Long cloudResourceId) {
        return upload(pending, cloudResourceId,
            (id, uploaded) -> store.checkpoint(pending.getPendingPublicationId(), id, uploaded));
    }

    /** 租户调用方将上传进度写入 Node，文件处理继续复用同一套校验。 */
    public List<GroupChatTaskFile> upload(ByaiGroupChatPendingPublication pending, Long cloudResourceId,
        java.util.function.BiConsumer<Long, String> checkpoint) {
        if (pending.getCloudResourceId() != null && !pending.getCloudResourceId().equals(cloudResourceId)) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.publication.driveChanged"));
        }
        List<String> sources = JSON.parseArray(pending.getSourceFilesJson(), String.class);
        JSONObject uploaded = JSON.parseObject(pending.getUploadedFilesJson());
        if (uploaded == null) {
            uploaded = new JSONObject();
        }
        List<GroupChatTaskFile> result = new ArrayList<>();
        for (int index = 0; index < sources.size(); index++) {
            String source = validateSourcePath(sources.get(index));
            List<GroupChatTaskFile> files;
            if (uploaded.containsKey(source)) {
                files = uploaded.getJSONArray(source).toJavaList(GroupChatTaskFile.class);
            } else {
                // 每份卡片、每个附件使用独立目录；重试不覆盖其他任务或其他版本的成果。
                String directory = "/group-task-results/" + pending.getTaskSessionId() + "/"
                    + pending.getPendingPublicationId() + "/" + index;
                files = uploadOne(source, cloudResourceId, directory);
                uploaded.put(source, files);
                checkpoint.accept(cloudResourceId, uploaded.toJSONString());
            }
            result.addAll(files);
        }
        return result;
    }

    public static String validateSourcePath(String source) {
        if (StringUtils.isBlank(source) || !source.startsWith("/by/") || source.endsWith("/")
            || source.contains("\\") || source.contains("\u0000")
            || List.of(source.split("/", -1)).stream().anyMatch(part -> ".".equals(part) || "..".equals(part))) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.publication.pathInvalid"));
        }
        String normalized = source.replaceAll("/+", "/");
        FileBrowserPathPolicy.assertBrowsable(normalized);
        return normalized;
    }

    private List<GroupChatTaskFile> uploadOne(String source, Long cloudResourceId, String directory) {
        Path temporary = null;
        try (InputStream input = userFS.read(source)) {
            if (input == null) {
                throw new IllegalArgumentException(I18nUtil.get("groupchat.publication.fileUnavailable", source));
            }
            temporary = Files.createTempFile("group-publication-", ".upload");
            // 路径转存没有经过 multipart 解析器，因此显式沿用平台单文件大小限制。
            long limit = DataSize.parse(maxFileSize).toBytes();
            long size = 0;
            try (OutputStream output = Files.newOutputStream(temporary)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    size += count;
                    if (limit >= 0 && size > limit) {
                        throw new IllegalArgumentException(I18nUtil.get("groupchat.publication.fileTooLarge"));
                    }
                    output.write(buffer, 0, count);
                }
            }
            String name = source.substring(source.lastIndexOf('/') + 1);
            MultipartFile file = new PublicationFile(temporary, name, Files.size(temporary));
            // 发布附件保留原始文件，显式关闭 ZIP 解压；同名冲突仍交由上传服务处理。
            UploadResult uploaded = datasets.uploadFiles(new MultipartFile[] {file}, cloudResourceId, directory,
                name, false, false, false, false, null, Map.of());
            if (uploaded == null || uploaded.getUploadItems() == null || uploaded.getUploadItems().isEmpty()
                || (uploaded.getFailedItems() != null && !uploaded.getFailedItems().isEmpty())) {
                throw new IllegalStateException(I18nUtil.get("groupchat.publication.uploadFailed", source));
            }
            List<GroupChatTaskFile> result = new ArrayList<>();
            for (UploadItem item : uploaded.getUploadItems()) {
                if (Boolean.FALSE.equals(item.getSuccess()) || StringUtils.isBlank(item.getFilePath())
                    || StringUtils.isBlank(item.getFileName()) || !item.getFilePath().startsWith(directory + "/")
                    || item.getFilePath().contains("..")) {
                    throw new IllegalStateException(I18nUtil.get("groupchat.publication.uploadReferenceInvalid"));
                }
                GroupChatTaskFile reference = new GroupChatTaskFile();
                reference.setFileId(item.getFileId());
                reference.setFileName(item.getFileName());
                reference.setFilePath(item.getFilePath());
                result.add(reference);
            }
            return result;
        } catch (IOException e) {
            throw new IllegalStateException(I18nUtil.get("groupchat.publication.uploadFailed", source), e);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    temporary.toFile().deleteOnExit();
                }
            }
        }
    }

    /** 临时文件可重复读取，避免在进入上传服务前将整个产出物加载进堆内存。 */
    private record PublicationFile(Path path, String originalFilename, long size) implements MultipartFile {
        @Override public String getName() { return "files"; }
        @Override public String getOriginalFilename() { return originalFilename; }
        @Override public String getContentType() { return "application/octet-stream"; }
        @Override public boolean isEmpty() { return size == 0; }
        @Override public long getSize() { return size; }
        @Override public byte[] getBytes() throws IOException { return Files.readAllBytes(path); }
        @Override public InputStream getInputStream() throws IOException { return Files.newInputStream(path); }
        @Override public void transferTo(File destination) throws IOException {
            Files.copy(path, destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
