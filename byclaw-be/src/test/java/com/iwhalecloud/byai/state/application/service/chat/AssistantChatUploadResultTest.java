package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

class AssistantChatUploadResultTest {

    private AssistantChatApplicationService service;
    private ConversationFileStorage storage;
    private FilesService files;

    @BeforeEach
    void setUp() {
        service = new AssistantChatApplicationService(mock(GatewayClient.class));
        storage = mock(ConversationFileStorage.class);
        files = mock(FilesService.class);
        ConversationStoragePathResolver paths = mock(ConversationStoragePathResolver.class);
        when(paths.conversationFile(any(), eq("42"), anyString())).thenAnswer(invocation ->
            StorageLocation.of("conversation", "user-root", "/.sessions/42/" + invocation.getArgument(2)));
        when(paths.normalizeDisplayFilePath(anyString())).thenAnswer(invocation -> invocation.getArgument(0));
        when(files.createUploadFile(anyString(), anyString(), anyString(), isNull(), eq(-1L), eq(42L), anyString()))
            .thenAnswer(invocation -> {
                Files record = new Files();
                record.setFileId(123L);
                record.setConvertFileName(invocation.getArgument(1));
                return record;
            });
        ReflectionTestUtils.setField(service, "conversationFileStorage", storage);
        ReflectionTestUtils.setField(service, "conversationStoragePathResolver", paths);
        ReflectionTestUtils.setField(service, "filesService", files);
        ReflectionTestUtils.setField(service, "sessionService", mock(SessionService.class));
        ReflectionTestUtils.setField(service, "byaiSystemConfigService", mock(ByaiSystemConfigService.class));
    }

    @Test
    void persistedUploadsReturnTerminalSuccessAndAccurateSummary() throws Exception {
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserCode).thenReturn("0027024710");
            SessionUploadResult result = service.uploadFiles(new MultipartFile[] {
                upload("notes.txt"), upload("notes.txt")
            }, 42L, "H_AS", null, null);

            assertThat(result.getUploadItems()).hasSize(2).allSatisfy(item -> {
                assertThat(item.getSuccess()).isTrue();
                assertThat(item.getFileId()).isEqualTo(123L);
                assertThat(item.getFilePath()).startsWith("/.sessions/42/");
                assertThat(item.getFileUrl()).contains("/commonFile/preview");
            });
            assertThat(result.getUploadItems()).extracting(item -> item.getFileName())
                .containsExactly("notes.txt", "notes(1).txt");
            assertThat(result.getSummary().getTotal()).isEqualTo(2);
            assertThat(result.getSummary().getSucceeded()).isEqualTo(2);
            assertThat(result.getSummary().getFailed()).isZero();
            assertThat(result.getFailedItems()).isEmpty();
            verify(storage, times(2)).writeBytes(any(), any(), eq("text/plain"));
        }
    }

    @Test
    void failedStorageWriteStillRejectsUploadInsteadOfReportingSuccess() throws Exception {
        doThrow(new IllegalStateException("write failed")).when(storage).writeBytes(any(), any(), any());
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserCode).thenReturn("0027024710");
            assertThatThrownBy(() -> service.uploadFiles(new MultipartFile[] {upload("notes.txt")},
                42L, "H_AS", null, null)).isInstanceOf(IllegalStateException.class).hasMessage("write failed");
        }
    }

    private MultipartFile upload(String name) {
        return new MockMultipartFile("files", name, "text/plain", new byte[] {1, 2, 3});
    }
}
