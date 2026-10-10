package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatFileQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatFileListResponse;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatFileController;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** 使用真实附件投影验证文件分页，Mapper 排序及可见条件另由 SQL 集成测试覆盖。 */
class GroupChatFileQueryServiceTest {
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatContextService context = new GroupChatContextService(messages,
        mock(SessionService.class), mock(SsResourceService.class));
    private final GroupChatFileQueryService service = new GroupChatFileQueryService(messages, authorization, context);
    private final List<ByaiMessage> stored = new ArrayList<>();
    private final Comparator<ByaiMessage> order = Comparator.comparing(ByaiMessage::getCreateTime)
        .thenComparing(ByaiMessage::getMessageId).reversed();

    @BeforeEach
    void setup() {
        when(messages.selectGroupFileMessagePage(eq(10L), any(), anyBoolean(), anyInt())).thenAnswer(call -> {
            Long before = call.getArgument(1);
            boolean inclusive = call.getArgument(2);
            int limit = call.getArgument(3);
            ByaiMessage anchor = before == null ? null : stored.stream()
                .filter(row -> row.getMessageId().equals(before)).findFirst().orElseThrow();
            return stored.stream().filter(row -> !row.isRecalled())
                .filter(row -> anchor == null || (inclusive ? order.compare(row, anchor) >= 0 : order.compare(row, anchor) > 0))
                .sorted(order).limit(limit).toList();
        });
    }

    @Test
    void fillsPagesAcrossMessagesAndResumesWithinMultiFileMessage() {
        stored.add(upload(100L, 3000, "a", "b", "c"));
        stored.add(upload(200L, 2000, "d"));
        stored.add(upload(50L, 1000, "e"));
        var first = service.list(10L, 2, null);
        assertThat(ids(first)).containsExactly("a", "b");
        assertThat(first.getPageSize()).isEqualTo(2);
        assertThat(first.isHasMore()).isTrue();
        assertThat(first.getFiles()).extracting("messageId").containsExactly("100", "100");
        assertThat(first.getFiles().get(0).getCreatedAt()).isEqualTo(3000L);
        assertThat(first.getFiles().get(0).getAttachment().getFilePath()).isEqualTo("/uploads/a");
        // 下一页保持原来的时间边界，不混入分页期间新发送的消息。
        stored.add(upload(999L, 4000, "new"));
        var second = service.list(10L, 2, first.getNextCursor());
        assertThat(ids(second)).containsExactly("c", "d");
        assertThat(second.isHasMore()).isTrue();
        var last = service.list(10L, 2, second.getNextCursor());
        assertThat(ids(last)).containsExactly("e");
        assertThat(last.isHasMore()).isFalse();
        assertThat(last.getNextCursor()).isNull();
        verify(authorization, times(3)).requireCurrentUserMember(10L);
    }

    @Test
    void continuesPastSparseAndMalformedCandidatesUntilPageIsFull() {
        IntStream.range(1, 101).forEach(id -> {
            ByaiMessage row = upload((long) id, 1000 + id);
            row.setMetadata(id % 2 == 0 ? "{}" : "broken JSON");
            row.setRelatedResources("invalid JSON");
            stored.add(row);
        });
        stored.add(upload(200L, 500, "a", "b", "c"));
        var page = service.list(10L, 2, null);
        assertThat(ids(page)).containsExactly("a", "b");
        assertThat(page.isHasMore()).isTrue();
        verify(messages).selectGroupFileMessagePage(10L, null, false, 100);
        verify(messages).selectGroupFileMessagePage(10L, 1L, false, 100);
    }

    @Test
    void preservesTaskPreviewFieldsAndImagesWithoutCountingInvalidAttachments() {
        ByaiMessage row = upload(100L, 3000, "image");
        JSONObject resources = JSON.parseObject(row.getRelatedResources());
        resources.getJSONArray("files").getJSONObject(0).put("fileType", "image/png");
        resources.getJSONArray("files").add(new JSONObject());
        row.setRelatedResources(resources.toJSONString());
        row.setMetadata("{\"scene\":\"GROUP_CHAT\",\"kind\":\"TASK_RESULT\",\"files\":["
            + "{\"fileName\":\"report.md\",\"filePath\":\"/cloud/report.md\",\"cloudResourceId\":\"700\"},{}]}");
        stored.add(row);
        var page = service.list(10L, 2, null);
        assertThat(page.getFiles()).hasSize(2);
        assertThat(page.getFiles().get(0).getAttachment().getMediaType()).isEqualTo("image/png");
        var taskFile = page.getFiles().get(1).getAttachment();
        assertThat(taskFile.getFilePath()).isEqualTo("/cloud/report.md");
        assertThat(taskFile.getCloudResourceId()).isEqualTo("700");
        assertThat(page.isHasMore()).isFalse();
        assertThat(page.getNextCursor()).isNull();
    }

    @Test
    void recalledCursorMessageDoesNotPreventReadingOlderFiles() {
        ByaiMessage latest = upload(100L, 3000, "a", "b", "c");
        stored.add(latest);
        stored.add(upload(50L, 2000, "d", "e"));
        var first = service.list(10L, 2, null);
        latest.setRecalledAt(new Date());
        var next = service.list(10L, 2, first.getNextCursor());
        assertThat(ids(next)).containsExactly("d", "e");
        assertThat(next.isHasMore()).isFalse();
    }

    @Test
    void emptyGroupReturnsTerminalPageAndDefaultSizeIsTwenty() {
        var page = service.list(10L, null, null);
        assertThat(page.getFiles()).isEmpty();
        assertThat(page.getPageSize()).isEqualTo(20);
        assertThat(page.isHasMore()).isFalse();
        assertThat(page.getNextCursor()).isNull();
    }

    @Test
    void rejectsInvalidPageSizesAndForeignOrMalformedCursorsBeforeQuerying() {
        for (int size : List.of(0, -1, 51)) {
            assertThatThrownBy(() -> service.list(10L, size, null)).isInstanceOf(ResponseStatusException.class);
        }
        for (String cursor : List.of("!", "x".repeat(257), encoded("1:11:100:0"), encoded("2:10:100:0"),
            encoded("1:10:0:0"), encoded("1:10:100:-1"), encoded("1:10:100:2147483648"))) {
            assertThatThrownBy(() -> service.list(10L, 2, cursor)).isInstanceOf(ResponseStatusException.class);
        }
        verifyNoInteractions(messages);
    }

    @Test
    void nonMemberCannotQueryAttachments() {
        doThrow(new IllegalArgumentException("not a member")).when(authorization).requireCurrentUserMember(10L);
        assertThatThrownBy(() -> service.list(10L, 2, null)).hasMessage("not a member");
        verifyNoInteractions(messages);
    }

    @Test
    void getEndpointBindsPaginationAndReturnsPreviewPath() throws Exception {
        stored.add(upload(100L, 3000, "a", "b", "c"));
        var mvc = MockMvcBuilders.standaloneSetup(new GroupChatFileController(service)).build();
        mvc.perform(get("/group-chats/10/files").param("pageSize", "2"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.files.length()").value(2))
            .andExpect(jsonPath("$.data.files[0].messageId").value("100"))
            .andExpect(jsonPath("$.data.files[0].attachment.filePath").value("/uploads/a"))
            .andExpect(jsonPath("$.data.hasMore").value(true))
            .andExpect(jsonPath("$.data.nextCursor").isString());
        mvc.perform(get("/group-chats/10/files").param("pageSize", "0")).andExpect(status().isBadRequest());
    }

    private List<String> ids(GroupChatFileListResponse page) {
        return page.getFiles().stream().map(item -> item.getAttachment().getFileId()).toList();
    }

    private String encoded(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private ByaiMessage upload(Long messageId, long time, String... ids) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(messageId);
        message.setSessionId(10L);
        message.setCreateTime(new Date(time));
        List<JSONObject> files = new ArrayList<>();
        for (String id : ids) {
            JSONObject file = new JSONObject();
            file.put("fileId", id);
            file.put("fileName", id + ".md");
            file.put("filePath", "/uploads/" + id);
            files.add(file);
        }
        JSONObject resources = new JSONObject();
        resources.put("files", files);
        message.setRelatedResources(resources.toJSONString());
        return message;
    }
}
