package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-18 13:55:00
 * @description TODO
 */
@Getter
@Setter
public class StopChatDto {

    private Long agentId;

    private String agentCode;

    private Long sessionId;

    private Long messageId;

    private String clientId;

}
