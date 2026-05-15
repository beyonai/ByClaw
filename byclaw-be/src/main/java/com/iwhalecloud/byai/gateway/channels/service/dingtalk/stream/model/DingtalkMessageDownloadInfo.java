package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DingtalkMessageDownloadInfo {

    private String downloadCode;
    private String fileName;
    private String downloadUrl;

    public DingtalkMessageDownloadInfo(String downloadCode, String fileName) {
        this.downloadCode = downloadCode;
        this.fileName = fileName;
    }
}
