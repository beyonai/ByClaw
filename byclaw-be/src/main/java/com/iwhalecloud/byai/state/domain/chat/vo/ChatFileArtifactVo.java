package com.iwhalecloud.byai.state.domain.chat.vo;

import lombok.Builder;
import lombok.Getter;

/**
 * 已确认可下载的会话文件。
 *
 * @author qin.guoquan
 * @date 2026-08-18 20:00:38
 */
@Getter
@Builder
public class ChatFileArtifactVo {

    private String sourcePath;

    private String path;

    private String fileName;

    private Long fileSize;

    private String contentType;
}
