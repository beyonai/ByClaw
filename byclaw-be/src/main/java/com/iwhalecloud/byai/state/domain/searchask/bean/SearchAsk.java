package com.iwhalecloud.byai.state.domain.searchask.bean;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-04 15:14:39
 * @description TODO
 */

@Getter
@Setter
public class SearchAsk {

    /**
     * 会话标识
     */
    private Long sessionId;

    /**
     * 聊天内容
     */
    private String chatContent;

    /**
     * 搜问模式
     */
    private String mode;
}
