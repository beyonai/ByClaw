package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.OutputStream;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

class FileBrowserApplicationServiceCredentialPolicyTest {

    private FileBrowserProvider provider;
    private FileBrowserApplicationService service;

    @BeforeEach
    void setUp() {
        provider = mock(FileBrowserProvider.class);
        FileBrowserProviderFactory providerFactory = mock(FileBrowserProviderFactory.class);
        when(providerFactory.getProvider()).thenReturn(provider);
        service = new FileBrowserApplicationService(providerFactory,
            mock(ByClawSkillResourceApplicationService.class), mock(UserFS.class), mock(ObjectMapper.class));
    }

    @Test
    void rootListingHidesCredentialDirectory() {
        when(provider.list("user", 10L, "/")).thenReturn(List.of(
            item("/.connector-auth", true),
            item("/.openclaw", true),
            item("/README.md", false)));

        assertThat(service.list("user", 10L, "/"))
            .extracting(FileBrowserItemVo::getPath)
            .containsExactly("/.openclaw", "/README.md");
    }

    @Test
    void directCredentialAccessIsRejectedBeforeProviderCall() {
        assertThatThrownBy(() -> service.download("user", 10L,
            "/by/.connector-auth/.github/credential.json"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("系统凭据目录");
        verify(provider, never()).download("user", 10L,
            "/by/.connector-auth/.github/credential.json");
    }

    @Test
    void recursiveOperationsCannotStartAboveCredentialDirectory() {
        assertThatThrownBy(() -> service.downloadFolder("user", 10L, "/", OutputStream.nullOutputStream()))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.copy("user", 10L, "/by", "/workspace"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void destinationNameCannotCreateOrReplaceCredentialDirectory() {
        assertThatThrownBy(() -> service.copy("user", 10L, "/workspace/.connector-auth", "/"))
            .isInstanceOf(IllegalArgumentException.class);
        MultipartFile upload = mock(MultipartFile.class);
        when(upload.getOriginalFilename()).thenReturn(".connector-auth");
        assertThatThrownBy(() -> service.upload("user", 10L, "/", new MultipartFile[]{upload}))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void similarlyNamedNormalDirectoryRemainsAccessible() {
        when(provider.list("user", 10L, "/.connector-auth-backup")).thenReturn(List.of());

        assertThat(service.list("user", 10L, "/.connector-auth-backup")).isEmpty();

        verify(provider).list("user", 10L, "/.connector-auth-backup");
    }

    private FileBrowserItemVo item(String path, boolean directory) {
        FileBrowserItemVo item = new FileBrowserItemVo();
        item.setPath(path);
        item.setName(path.substring(path.lastIndexOf('/') + 1));
        item.setDir(directory);
        return item;
    }
}
