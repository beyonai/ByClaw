package com.iwhalecloud.byai.state.domain.session.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 复制模板会话成员响应DTO
 *
 * @author smartcloud
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateMembersCopyResponseDto implements Serializable {

    /**
     * 模板会话ID
     */
    private Long templateSessionId;

    /**
     * 原会话ID
     */
    private Long originalSessionId;

    /**
     * 复制的成员总数
     */
    private Integer totalCount;

    /**
     * 成功复制的成员数量
     */
    private Integer successCount;

    /**
     * 失败的成员数量
     */
    private Integer failedCount;

    /**
     * 复制开始时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime startTime;

    /**
     * 复制完成时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime endTime;

    /**
     * 复制结果详情
     */
    private List<MemberCopyResult> results;

    /**
     * 成员复制结果
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MemberCopyResult implements Serializable {
        /**
         * 原用户ID
         */
        private String originalUserId;

        /**
         * 新用户ID
         */
        private String newUserId;

        /**
         * 用户角色
         */
        private String role;

        /**
         * 复制状态：SUCCESS, FAILED
         */
        private String status;

        /**
         * 错误信息（失败时）
         */
        private String errorMessage;
    }
}
