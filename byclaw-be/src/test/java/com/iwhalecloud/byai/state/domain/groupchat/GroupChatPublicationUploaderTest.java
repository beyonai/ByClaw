package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.times;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationStore;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPublicationUploader;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile;

class GroupChatPublicationUploaderTest {
    private final UserFS userFS = mock(UserFS.class);
    private final DatasetApplicationService datasets = mock(DatasetApplicationService.class);
    private final GroupChatPendingPublicationStore store = mock(GroupChatPendingPublicationStore.class);
    private final GroupChatPublicationUploader uploader = new GroupChatPublicationUploader(userFS, datasets, store);

    @Test
    void uploadsToBoundCloudAndRetrySkipsAlreadyUploadedFile() throws Exception {
        ByaiGroupChatPendingPublication pending = pending();
        when(userFS.read(anyString())).thenAnswer(invocation -> new ByteArrayInputStream(new byte[] {1, 2}));
        AtomicReference<Boolean> failSecond = new AtomicReference<>(true);
        when(datasets.uploadFiles(any(), eq(777L), anyString(), anyString(), eq(false), eq(false), eq(true), any()))
            .thenAnswer(invocation -> {
                String directory = invocation.getArgument(2);
                MultipartFile file = ((MultipartFile[]) invocation.getArgument(0))[0];
                assertThat(file.getBytes()).containsExactly(1, 2);
                assertThat(directory).startsWith("/group-task-results/60/100/");
                if (directory.endsWith("/1") && failSecond.get()) {
                    throw new IllegalStateException("second upload failed");
                }
                return uploaded(directory + "/" + file.getOriginalFilename());
            });
        // 模拟独立提交的进度：整体发布失败后，后续请求仍能读取先前成功的文件结果。
        doAnswer(invocation -> {
            pending.setUploadedFilesJson(invocation.getArgument(2));
            pending.setCloudResourceId(invocation.getArgument(1));
            return null;
        }).when(store).checkpoint(eq(100L), eq(777L), anyString());

        assertThatThrownBy(() -> uploader.upload(pending, 777L)).hasMessage("second upload failed");
        assertThat(pending.getUploadedFilesJson()).contains("a.md").doesNotContain("b.md");
        failSecond.set(false);
        List<GroupChatTaskFile> result = uploader.upload(pending, 777L);
        assertThat(result).extracting(GroupChatTaskFile::getFileName).containsExactly("a.md", "b.md");
        verify(userFS, times(1)).read("/by/.sessions/60/a.md");
        verify(userFS, times(2)).read("/by/.sessions/60/b.md");
        verify(store, times(2)).checkpoint(eq(100L), eq(777L), anyString());
    }

    @Test
    void sourceTransferEnforcesPlatformUploadLimit() {
        ReflectionTestUtils.setField(uploader, "maxFileSize", "1B");
        when(userFS.read(anyString())).thenReturn(new ByteArrayInputStream(new byte[] {1, 2}));
        assertThatThrownBy(() -> uploader.upload(pending(), 777L)).hasMessageContaining("size limit");
        verifyNoInteractions(store, datasets);
    }

    @Test
    void changedProjectCloudCannotReuseOldUploadReferences() {
        ByaiGroupChatPendingPublication pending = pending();
        pending.setCloudResourceId(777L);
        assertThatThrownBy(() -> uploader.upload(pending, 888L)).hasMessageContaining("cloud drive changed");
        verifyNoInteractions(userFS, datasets);
    }

    @Test
    void partialFailureResponseDoesNotCheckpointIncompleteAttachment() throws Exception {
        ByaiGroupChatPendingPublication pending = pending();
        when(userFS.read(anyString())).thenReturn(new ByteArrayInputStream(new byte[] {1}));
        UploadResult result = uploaded("/group-task-results/60/100/0/a.md");
        result.getFailedItems().add(new UploadItem());
        when(datasets.uploadFiles(any(), any(), any(), any(), any(), any(), eq(true), any())).thenReturn(result);
        assertThatThrownBy(() -> uploader.upload(pending, 777L)).hasMessageContaining("upload failed");
        verifyNoInteractions(store);
    }

    @Test
    void sourceReadFailureKeepsPendingProgressUntouched() {
        when(userFS.read(anyString())).thenReturn(null);
        assertThatThrownBy(() -> uploader.upload(pending(), 777L)).hasMessageContaining("unavailable");
        verifyNoInteractions(store, datasets);
    }

    private ByaiGroupChatPendingPublication pending() {
        ByaiGroupChatPendingPublication pending = new ByaiGroupChatPendingPublication();
        pending.setTaskSessionId(60L);
        pending.setPendingPublicationId(100L);
        pending.setSourceFilesJson(JSON.toJSONString(List.of("/by/.sessions/60/a.md", "/by/.sessions/60/b.md")));
        pending.setUploadedFilesJson("{}");
        return pending;
    }

    private UploadResult uploaded(String path) {
        UploadItem item = new UploadItem();
        item.setSuccess(true);
        item.setFileName(path.substring(path.lastIndexOf('/') + 1));
        item.setFilePath(path);
        UploadResult result = new UploadResult();
        result.getUploadItems().add(item);
        return result;
    }
}
