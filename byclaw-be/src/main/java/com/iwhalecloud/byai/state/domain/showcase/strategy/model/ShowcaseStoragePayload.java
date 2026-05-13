package com.iwhalecloud.byai.state.domain.showcase.strategy.model;

import java.io.Serializable;
import java.util.Arrays;

/**
 * 成果对象存储处理过程中的数据载体
 *
 * <p>该载体用于在下载原始文件与上传对象存储之间传递必要的上下文信息。</p>
 */
public final class ShowcaseStoragePayload implements Serializable {

    private static final long serialVersionUID = 1L;

    private final byte[] fileContent;

    private final String fileName;

    private final String mediaType;

    private final String objectUrl;

    private final String fileId;

    private final String fileCode;

    private ShowcaseStoragePayload(byte[] fileContent, String fileName, String mediaType, String objectUrl,
        String fileId, String fileCode) {
        this.fileContent = fileContent == null ? new byte[0] : Arrays.copyOf(fileContent, fileContent.length);
        this.fileName = fileName;
        this.mediaType = mediaType;
        this.objectUrl = objectUrl;
        this.fileId = fileId;
        this.fileCode = fileCode;
    }

    public static ShowcaseStoragePayload of(byte[] fileContent, String fileName, String mediaType) {
        return new ShowcaseStoragePayload(fileContent, fileName, mediaType, null, null, null);
    }

    public static ShowcaseStoragePayload withObjectUrl(String objectUrl) {
        return withObjectUrl(objectUrl, null, null, null, null);
    }

    public static ShowcaseStoragePayload withObjectUrl(String objectUrl, String fileName, String contentType,
        String fileId) {
        return withObjectUrl(objectUrl, fileName, contentType, fileId, null);
    }

    public static ShowcaseStoragePayload withObjectUrl(String objectUrl, String fileName, String contentType,
        String fileId, String fileCode) {
        return new ShowcaseStoragePayload(new byte[0], fileName, contentType, objectUrl, fileId, fileCode);
    }

    public static ShowcaseStoragePayload empty() {
        return new ShowcaseStoragePayload(new byte[0], null, null, null, null, null);
    }

    public byte[] getFileContent() {
        return Arrays.copyOf(fileContent, fileContent.length);
    }

    public String getFileName() {
        return fileName;
    }

    public String getMediaType() {
        return mediaType;
    }

    public String getObjectUrl() {
        return objectUrl;
    }

    public String getFileId() {
        return fileId;
    }

    public String getFileCode() {
        return fileCode;
    }

    /**
     * 判断当前载体是否为空
     *
     * @return true 表示未包含任何数据
     */
    public boolean isEmpty() {
        return (fileContent == null || fileContent.length == 0)
            && objectUrl == null;
    }
}


