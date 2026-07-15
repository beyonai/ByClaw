package com.iwhalecloud.byai.common.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;

@ExtendWith(MockitoExtension.class)
public class ByclawUserFSTest {

    private static final String NAMESPACE = "byclaw-fs";
    private static final String USER_BUCKET_OR_ROOT = "byclaw-user001";
    private static final String SHARE_TYPE_PRIVATE = "private";

    @Mock
    private ObjectStorage objectStorage;

    @Mock
    private UserStorageQuotaApplicationService storageQuotaService;

    @BeforeEach
    void setUp() {
        CurrentUserHolder.clearLoginInfo();
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void init_delegatesToObjectStorage() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage);

        byclawUserFS.init();

        verify(objectStorage).init(USER_BUCKET_OR_ROOT);
        verify(objectStorage, never()).mount(USER_BUCKET_OR_ROOT);
    }

    @Test
    void mount_delegatesToObjectStorage() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage);

        byclawUserFS.mount();

        verify(objectStorage).mount(USER_BUCKET_OR_ROOT);
    }

    @Test
    void read_usesCurrentUserBucket() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage);
        InputStream expected = new ByteArrayInputStream(new byte[] {1});
        when(objectStorage.get(any())).thenReturn(expected);

        InputStream actual = byclawUserFS.read("/.sessions/session-001/output.md");

        assertThat(actual).isSameAs(expected);
        verify(objectStorage).get(StorageLocation.of(NAMESPACE, USER_BUCKET_OR_ROOT,
            "/by/.sessions/session-001/output.md", SHARE_TYPE_PRIVATE));
    }

    @Test
    void write_usesCurrentUserBucket() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage);
        MockMultipartFile multipartFile = new MockMultipartFile("file", "openclaw.json", "application/json",
            "{\"a\":1}".getBytes());
        FileMetadata metadata = new FileMetadata();
        when(objectStorage.put(any(), any(), anyLong(), any())).thenReturn(metadata);

        FileMetadata actual = byclawUserFS.write(multipartFile, "/.openclaw/");

        assertThat(actual).isSameAs(metadata);
        verify(objectStorage).put(
            eq(StorageLocation.of(NAMESPACE, USER_BUCKET_OR_ROOT, "/by/.openclaw/openclaw.json", SHARE_TYPE_PRIVATE)),
            any(), eq(multipartFile.getSize()), eq(multipartFile.getContentType()));
    }

    @Test
    void successfulWriteCommitsReservedBytes() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage, storageQuotaService);
        MockMultipartFile multipartFile = new MockMultipartFile("file", "quota.txt", "text/plain",
            "quota".getBytes());
        when(objectStorage.put(any(), any(), anyLong(), any())).thenReturn(new FileMetadata());

        byclawUserFS.write(multipartFile, "/quota/");

        verify(storageQuotaService).reserveWrite(7L, multipartFile.getSize());
        verify(storageQuotaService).commitWrite(7L, multipartFile.getSize());
        verify(storageQuotaService, never()).releaseWrite(any(), anyLong());
    }

    @Test
    void failedWriteReleasesReservedBytes() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage, storageQuotaService);
        MockMultipartFile multipartFile = new MockMultipartFile("file", "quota.txt", "text/plain",
            "quota".getBytes());
        when(objectStorage.put(any(), any(), anyLong(), any())).thenThrow(new IllegalStateException("write failed"));

        assertThatThrownBy(() -> byclawUserFS.write(multipartFile, "/quota/"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("write failed");

        verify(storageQuotaService).reserveWrite(7L, multipartFile.getSize());
        verify(storageQuotaService).releaseWrite(7L, multipartFile.getSize());
        verify(storageQuotaService, never()).commitWrite(any(), anyLong());
    }

    @Test
    void list_usesCurrentUserBucket() {
        CurrentUserHolder.setLoginInfo(loginInfo("user001"));
        ByclawUserFS byclawUserFS = new ByclawUserFS(objectStorage);
        when(objectStorage.list(any(), any())).thenReturn(List.of(
            StorageObject.builder().path("byclaw-user001/by/.openclaw/tool-a/config.json").build(),
            StorageObject.builder().path("byclaw-user001/by/.openclaw/tool-b/config.json").build()));

        List<String> paths = byclawUserFS.list("/.openclaw/", null);

        assertThat(paths).containsExactly(
            "/.openclaw/tool-a/config.json",
            "/.openclaw/tool-b/config.json");
        verify(objectStorage).list(StoragePrefix.of(NAMESPACE, USER_BUCKET_OR_ROOT, "/by/.openclaw/",
            SHARE_TYPE_PRIVATE), 3);
    }

    private LoginInfo loginInfo(String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(7L);
        loginInfo.setUserCode(userCode);
        return loginInfo;
    }
}
