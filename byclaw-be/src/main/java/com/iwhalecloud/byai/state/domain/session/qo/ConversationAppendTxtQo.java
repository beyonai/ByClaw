package com.iwhalecloud.byai.state.domain.session.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18
 * @description
 */
@Getter
@Setter
public class ConversationAppendTxtQo {

    private String userCode;

    private String sessionId;

    private String filePath;

    private String content;
}
