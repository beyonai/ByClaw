package com.iwhalecloud.byai.state.domain.session.dto;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.Map;

/**
 * 复制模板会话成员请求DTO
 *
 * @author smartcloud
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateMembersCopyRequestDto implements Serializable {

    /**
     * 原会话ID，必传
     */
    @NotNull(message = "原会话ID不能为空")
    private Long originalSessionId;

    /**
     * 会话成员记录ID映射关系，可选
     * key: 原会话成员记录ID, value: 新会话成员记录ID
     * 如果不提供，则直接复制原记录ID
     */
    @NotNull(message = "会话成员记录ID映射关系不能为空")
    private Map<Long, Long> sessionMemberIdMappings;
}
