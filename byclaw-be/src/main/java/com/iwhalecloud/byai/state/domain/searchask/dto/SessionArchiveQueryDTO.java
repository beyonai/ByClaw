package com.iwhalecloud.byai.state.domain.searchask.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 按 sessionId 反查归档的请求 DTO
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
public class SessionArchiveQueryDTO {

    /**
     * 会话标识（必填）
     */
    @NotNull(message = "{web.search.session.archive.sessionId.required}")
    private Long sessionId;
}
