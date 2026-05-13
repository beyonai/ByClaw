package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DingtalkMessageFileDownloadResult {

    private String downloadUrl;
    private String fileName;
    private String contentType;
    private String mediaType;
    private Long fileSize;
}
