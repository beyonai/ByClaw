package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

import com.fasterxml.jackson.annotation.JsonInclude;

import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

/** 群消息附件按文件数量分页，业务 ID 使用字符串保留精度。 */
@Data
public class GroupChatFileListResponse {
    private List<FileItem> files = new ArrayList<>();
    private int pageSize;
    private boolean hasMore;
    private String nextCursor;

    @Data
    public static class FileItem {
        private String messageId;
        private Long createdAt;
        /** 所属消息保存的真实作者 ID；字符串保留 bigint 精度，缺失时返回 null。 */
        @JsonInclude(JsonInclude.Include.ALWAYS)
        private String uploaderId;
        /** 所属消息保存的作者名称；旧消息缺失或空白时返回 null。 */
        @JsonInclude(JsonInclude.Include.ALWAYS)
        private String uploaderName;
        /** USER 或 AGENT；消息用途未知时不输出类型，不从附件元数据推断。 */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String uploaderType;
        /** 复用时间线附件字段，保留上传路径和云盘预览定位信息。 */
        private GroupChatContextResponse.Attachment attachment;
    }
}
