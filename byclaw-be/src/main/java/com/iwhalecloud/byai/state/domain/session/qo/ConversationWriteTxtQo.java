package com.iwhalecloud.byai.state.domain.session.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18
 * 会话文件覆盖写入请求。
 */
@Getter
@Setter
public class ConversationWriteTxtQo {

    /**
     * 用户编码，用于映射默认桶 byclaw-{userCode}。
     */
    private String userCode;

    /**
     * 会话标识。
     */
    private String sessionId;

    /**
     * 会话文件相对路径，例如 /datacloud/result.md。
     */
    private String filePath;

    /**
     * 文件内容。
     */
    private String content;
}
