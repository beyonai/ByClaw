package com.iwhalecloud.byai.state.domain.showcase.strategy.model;

import java.io.Serializable;
import java.util.Arrays;

/**
 * 成果空间下载结果
 */
public final class ShowcaseDownloadResult implements Serializable {

    private static final long serialVersionUID = 1L;

    private final byte[] data;

    private final String fileName;

    private final String contentType;

    private ShowcaseDownloadResult(byte[] data, String fileName, String contentType) {
        this.data = data == null ? new byte[0] : Arrays.copyOf(data, data.length);
        this.fileName = fileName;
        this.contentType = contentType;
    }

    public static ShowcaseDownloadResult of(byte[] data, String fileName, String contentType) {
        return new ShowcaseDownloadResult(data, fileName, contentType);
    }

    public byte[] getData() {
        return Arrays.copyOf(data, data.length);
    }

    public String getFileName() {
        return fileName;
    }

    public String getContentType() {
        return contentType;
    }
}




