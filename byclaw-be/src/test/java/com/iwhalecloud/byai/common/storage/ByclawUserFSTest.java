package com.iwhalecloud.byai.common.storage;

import static org.assertj.core.api.Assertions.assertThat;
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

@ExtendWith(MockitoExtension.class)
public class ByclawUserFSTest {

    private static final String NAMESPACE = "byclaw-fs";
    private static final String USER_BUCKET_OR_ROOT = "byclaw-user001";
    private static final String SHARE_TYPE_PRIVATE = "private";

    @Mock
    private ObjectStorage objectStorage;

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
        loginInfo.setUserCode(userCode);
        return loginInfo;
    }
}
