package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * @author zht
 * @version 1.0
 * @date 2025/9/15
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class AppendEventMsgDto {

    private Long userId;

    private Long sessionId;

    private String content;

    private String author;

    private Long messageId;
}
