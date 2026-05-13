package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18
 * @description
 */
@Getter
@Setter
@AllArgsConstructor
public class ConversationFilePathDto {

    /**
     * 文件相对路径。
     */
    private String filePath;

    private String objectKey;
}
