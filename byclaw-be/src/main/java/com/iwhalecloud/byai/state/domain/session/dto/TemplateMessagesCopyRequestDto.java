package com.iwhalecloud.byai.state.domain.session.dto;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * 复制模板会话消息请求DTO
 *
 * @author smartcloud
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateMessagesCopyRequestDto implements Serializable {


    /**
     * 原会话ID，必传
     */
    @NotNull(message = "原会话ID不能为空")
    private Long originalSessionId;

    /**
     * 消息ID列表，可选
     * 如果提供，则只复制指定的消息
     * 如果不提供或为空，则复制原会话的所有消息
     */
    private List<Long> messageIds;

    /**
     * 文件信息映射关系，可选
     * key: 原文件ID, value: 新文件信息
     * 如果为空，说明聊天记录没有涉及文件
     */
    private Map<String, FileInfo> fileMappings;

    /**
     * 文件信息
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FileInfo implements Serializable {

        /**
         * 新文件ID
         */
        private String fileId;

        /**
         * 文件名
         */
        private String fileName;

        /**
         * 文件大小
         */
        private Long fileSize;

        /**
         * 文件类型
         */
        private String fileType;

        /**
         * 文件URL
         */
        private String fileUrl;
    }
}
