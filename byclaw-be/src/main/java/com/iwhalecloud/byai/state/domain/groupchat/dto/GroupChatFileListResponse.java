package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

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
        /** 复用时间线附件字段，保留上传路径和云盘预览定位信息。 */
        private GroupChatContextResponse.Attachment attachment;
    }
}
