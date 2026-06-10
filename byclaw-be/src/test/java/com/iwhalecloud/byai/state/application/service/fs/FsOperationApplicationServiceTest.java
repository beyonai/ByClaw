package com.iwhalecloud.byai.state.application.service.fs;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.ResourceFS;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.state.domain.fs.dto.FsRenameRequest;
import com.iwhalecloud.byai.state.domain.fs.vo.FsDirectoryRenameResultVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsFileMetadataVo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FsOperationApplicationServiceTest {

    @Mock
    private UserFS userFS;

    @Mock
    private ResourceFS resourceFS;

    @Mock
    private AuthApplicationService authApplicationService;

    @Mock
    private SsResourceService ssResourceService;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void putFile_writesUserFsByCurrentLoginUser() {
        // USER 空间不接收外部 userCode，服务层只依赖 CurrentUserHolder 中的登录态。
        FsOperationApplicationService service = service();
        FileMetadata metadata = new FileMetadata();
        metadata.setFileSize(4L);
        metadata.setContentType("text/plain");
        when(userFS.write(any(MultipartFile.class), anyString())).thenReturn(metadata);

        FsFileMetadataVo result = service.putFile("USER", null, ".sessions/sess-1/out.txt", "text/plain",
            new MultipartFileUtil("file", "out.txt", "text/plain", "demo".getBytes(StandardCharsets.UTF_8)));

        assertThat(result.getSpaceType()).isEqualTo("USER");
        assertThat(result.getPath()).isEqualTo("/.sessions/sess-1/out.txt");
        assertThat(result.getFileSize()).isEqualTo(4L);
        verify(userFS).write(any(MultipartFile.class), org.mockito.ArgumentMatchers.eq("/.sessions/sess-1/out.txt"));
        verify(resourceFS, never()).write(any(MultipartFile.class), anyString());
    }

    @Test
    void putFile_acceptsUserStoragePrefixAndWritesSemanticPath() {
        // 外部调用可能传完整 MinIO 语义路径；服务层去掉当前用户桶和 /by 前缀，再交给 UserFS 统一补底层路径。
        FsOperationApplicationService service = service();
        FileMetadata metadata = new FileMetadata();
        when(userFS.write(any(MultipartFile.class), anyString())).thenReturn(metadata);

        service.putFile("USER", null, "/byclaw-user001/by/.sessions/sess-1/out.txt", "text/plain",
            new MultipartFileUtil("file", "out.txt", "text/plain", "demo".getBytes(StandardCharsets.UTF_8)));
        service.putFile("USER", null, "/by/.sessions/sess-2/out.txt", "text/plain",
            new MultipartFileUtil("file", "out.txt", "text/plain", "demo".getBytes(StandardCharsets.UTF_8)));

        verify(userFS).write(any(MultipartFile.class), eq("/.sessions/sess-1/out.txt"));
        verify(userFS).write(any(MultipartFile.class), eq("/.sessions/sess-2/out.txt"));
    }

    @Test
    void putFile_rejectsOtherUserStoragePrefix() {
        // 带 byclaw-{userCode}/by 前缀时，userCode 必须与当前登录用户一致。
        FsOperationApplicationService service = service();

        assertThatThrownBy(() -> service.putFile("USER", null, "/byclaw-other/by/.sessions/sess-1/out.txt",
            "text/plain",
            new MultipartFileUtil("file", "out.txt", "text/plain", "demo".getBytes(StandardCharsets.UTF_8))))
            .isInstanceOf(BaseException.class);
        verify(userFS, never()).write(any(MultipartFile.class), anyString());
    }

    @Test
    void downloadFile_rejectsResourceWithoutAccessPermission() {
        // RESOURCE 下载必须通过资源访问权限校验，不能只凭 resourceId 和路径读取。
        FsOperationApplicationService service = service();
        SsResource resource = new SsResource();
        resource.setResourceId(10001L);
        when(ssResourceService.findById(10001L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(false);

        assertThatThrownBy(() -> service.downloadFile("RESOURCE", 10001L,
            "/resource/doc/KG_DOC_10001/reports/out.md"))
            .isInstanceOf(BaseException.class);
    }

    @Test
    void putFile_rejectsResourcePathNotBelongingToResourceId() {
        // resourceId 和实际对象路径必须指向同一资源，避免跨资源路径写入。
        FsOperationApplicationService service = service();

        assertThatThrownBy(() -> service.putFile("RESOURCE", 10001L,
            "/resource/doc/KG_DOC_20002/reports/out.md", "text/plain",
            new MultipartFileUtil("file", "out.txt", "text/plain", "demo".getBytes(StandardCharsets.UTF_8))))
            .isInstanceOf(BaseException.class);
        verify(resourceFS, never()).write(any(MultipartFile.class), anyString());
    }

    @Test
    void renameDirectory_deletesOnlyCopiedSourceFilesWhenPartialCopyFails() {
        // 目录 rename 是 copy + delete；当中途失败时，只允许删除已经复制成功的源对象。
        FsOperationApplicationService service = service();
        SsResource resource = new SsResource();
        resource.setResourceId(10001L);
        when(ssResourceService.findById(10001L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        doAnswer(invocation -> {
            String path = invocation.getArgument(0);
            if ("/resource/doc/KG_DOC_10001/old/".equals(path)) {
                return List.of("/resource/doc/KG_DOC_10001/old/a.txt", "/resource/doc/KG_DOC_10001/old/b.txt");
            }
            return List.of();
        }).when(resourceFS).list(anyString(), isNull());
        when(resourceFS.read("/resource/doc/KG_DOC_10001/old/a.txt"))
            .thenReturn(new ByteArrayInputStream("a".getBytes(StandardCharsets.UTF_8)));
        when(resourceFS.read("/resource/doc/KG_DOC_10001/old/b.txt")).thenThrow(new IllegalStateException("read failed"));

        FsRenameRequest request = new FsRenameRequest();
        request.setSpaceType("RESOURCE");
        request.setResourceId(10001L);
        request.setOldPath("/resource/doc/KG_DOC_10001/old/");
        request.setNewPath("/resource/doc/KG_DOC_10001/new/");
        request.setOverwrite(false);

        FsDirectoryRenameResultVo result = service.renameDirectory(request);

        assertThat(result.getCopied()).isEqualTo(1);
        assertThat(result.getDeleted()).isEqualTo(1);
        assertThat(result.getFailed()).isEqualTo(1);
        verify(resourceFS).write(any(InputStream.class), eq(1L), eq("text/plain"),
            eq("/resource/doc/KG_DOC_10001/new/a.txt"));
        verify(resourceFS).delete("/resource/doc/KG_DOC_10001/old/a.txt");
        verify(resourceFS, never()).delete("/resource/doc/KG_DOC_10001/old/b.txt");
    }

    private FsOperationApplicationService service() {
        FsOperationApplicationService service = new FsOperationApplicationService();
        ReflectionTestUtils.setField(service, "userFS", userFS);
        ReflectionTestUtils.setField(service, "resourceFS", resourceFS);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        return service;
    }
}
