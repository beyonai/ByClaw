package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatFileListResponse;

/** 从最新群消息向前收集附件，文件分页独立于消息分页。 */
@Service
public class GroupChatFileQueryService {
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MESSAGE_BATCH_SIZE = 100;
    private final ByaiMessageMapper messages;
    private final GroupChatAuthorizationService authorization;
    private final GroupChatContextService context;

    public GroupChatFileQueryService(ByaiMessageMapper messages, GroupChatAuthorizationService authorization,
        GroupChatContextService context) {
        this.messages = messages;
        this.authorization = authorization;
        this.context = context;
    }

    public GroupChatFileListResponse list(Long sessionId, Integer requestedPageSize, String cursor) {
        authorization.requireCurrentUserMember(sessionId);
        int pageSize = requestedPageSize == null ? DEFAULT_PAGE_SIZE : requestedPageSize;
        if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "pageSize must be between 1 and 50");
        }
        Cursor resume = decodeCursor(sessionId, cursor);
        Long beforeMessageId = resume == null ? null : resume.messageId();
        boolean includeCursor = resume != null;
        Cursor lastIncluded = null;
        GroupChatFileListResponse response = new GroupChatFileListResponse();
        response.setPageSize(pageSize);
        while (true) {
            List<ByaiMessage> rows = messages.selectGroupFileMessagePage(sessionId, beforeMessageId,
                includeCursor, MESSAGE_BATCH_SIZE);
            if (rows == null || rows.isEmpty()) break;
            Map<Long, List<GroupChatContextResponse.Attachment>> projected = context.attachmentsForMessages(rows);
            for (ByaiMessage row : rows) {
                List<GroupChatContextResponse.Attachment> attachments = projected.getOrDefault(row.getMessageId(), List.of());
                // 游标消息也参与查询，从已返回附件的下一项继续，避免多文件消息跨页时丢失剩余项。
                int start = resume != null && row.getMessageId().equals(resume.messageId())
                    ? (int) Math.min(attachments.size(), (long) resume.attachmentIndex() + 1) : 0;
                for (int index = start; index < attachments.size(); index++) {
                    // 多发现一个有效附件才声明还有下一页，不按候选消息数量推断文件数量。
                    if (response.getFiles().size() == pageSize) {
                        response.setHasMore(true);
                        response.setNextCursor(encodeCursor(sessionId, lastIncluded));
                        return response;
                    }
                    GroupChatFileListResponse.FileItem item = new GroupChatFileListResponse.FileItem();
                    item.setMessageId(String.valueOf(row.getMessageId()));
                    item.setCreatedAt(row.getCreateTime() == null ? null : row.getCreateTime().getTime());
                    item.setAttachment(attachments.get(index));
                    response.getFiles().add(item);
                    lastIncluded = new Cursor(row.getMessageId(), index);
                }
            }
            if (rows.size() < MESSAGE_BATCH_SIZE) break;
            beforeMessageId = rows.get(rows.size() - 1).getMessageId();
            includeCursor = false;
        }
        return response;
    }

    private Cursor decodeCursor(Long sessionId, String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            if (cursor.length() > 256) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split(":", -1);
            if (parts.length != 4 || !"1".equals(parts[0]) || !sessionId.equals(Long.valueOf(parts[1]))) {
                throw new IllegalArgumentException();
            }
            long messageId = Long.parseLong(parts[2]);
            int index = Integer.parseInt(parts[3]);
            if (messageId <= 0 || index < 0) throw new IllegalArgumentException();
            return new Cursor(messageId, index);
        }
        catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid group file cursor");
        }
    }

    private String encodeCursor(Long sessionId, Cursor cursor) {
        String value = "1:" + sessionId + ":" + cursor.messageId() + ":" + cursor.attachmentIndex();
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    /** 附件位置基于时间线投影后的有效附件顺序；同一文件在不同消息中分别返回。 */
    private record Cursor(Long messageId, int attachmentIndex) {}
}
