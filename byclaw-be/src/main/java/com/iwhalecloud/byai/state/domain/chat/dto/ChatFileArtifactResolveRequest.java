package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 对话回复文件解析请求。
 *
 * @author qin.guoquan
 * @date 2026-08-18 20:00:38
 */
@Getter
@Setter
public class ChatFileArtifactResolveRequest {

    private Long sessionId;

    private String messageId;

    private List<String> paths;
}
