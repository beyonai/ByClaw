package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InOrder;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

/**
 * 验证头像必须写入登录用户记录，且失败不能返回成功地址。
 */
@ExtendWith(MockitoExtension.class)
class UserAvatarApplicationServiceTest {

    private static final String URL = "/commonFile/preview?style=minio&bucketName=byai-icon&filePath=/tester/avatar.png";

    private final UsersMapper usersMapper = mock(UsersMapper.class);
    private final FilesApplicationService filesService = mock(FilesApplicationService.class);
    private final UserAvatarApplicationService service = new UserAvatarApplicationService(filesService, usersMapper);

    @Captor
    private ArgumentCaptor<LambdaUpdateWrapper<Users>> updateCaptor;

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(Users.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Users.class);
        }
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        loginInfo.setUserCode("tester");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void uploadUpdatesOnlyCurrentUsersAvatarAndReturnsPersistedUrl() throws Exception {
        activeUser();
        storedIcon();
        when(usersMapper.update(isNull(), any())).thenReturn(1);
        MultipartFile file = image();

        assertThat(service.uploadAvatar(file)).isEqualTo(URL);

        InOrder order = inOrder(filesService, usersMapper);
        ArgumentCaptor<MultipartFile> uploadCaptor = ArgumentCaptor.forClass(MultipartFile.class);
        order.verify(filesService).uploadIcon(uploadCaptor.capture());
        order.verify(usersMapper).update(isNull(), updateCaptor.capture());
        assertThat(uploadCaptor.getValue().getBytes()).isEqualTo(file.getBytes());
        assertThat(uploadCaptor.getValue().getOriginalFilename()).matches("[a-f0-9-]+\\.png");
        LambdaUpdateWrapper<Users> update = updateCaptor.getValue();
        assertThat(update.getSqlSegment()).contains("user_id =", "state =");
        assertThat(update.getSqlSet()).contains("thumbnail_uri=", "update_date=")
            .doesNotContain("user_name", "pwd", "email");
        assertThat(update.getParamNameValuePairs().values()).contains(1001L, "A", URL);
    }

    @Test
    void unauthenticatedUploadDoesNotStoreAnything() {
        CurrentUserHolder.clearLoginInfo();

        assertThatThrownBy(() -> service.uploadAvatar(image())).isInstanceOf(BaseException.class);
        verifyNoInteractions(filesService, usersMapper);
    }

    @Test
    void uploadUsesIconBucketAndPersistsTheSamePreviewUrl() throws Exception {
        activeUser();
        when(usersMapper.update(isNull(), any())).thenReturn(1);
        CommonFileStorage storage = mock(CommonFileStorage.class);
        FilesService metadataService = mock(FilesService.class);
        SequenceService sequenceService = mock(SequenceService.class);
        when(sequenceService.nextVal()).thenReturn(2001L);
        FilesApplicationService iconService = new FilesApplicationService();
        ReflectionTestUtils.setField(iconService, "commonFileStorage", storage);
        ReflectionTestUtils.setField(iconService, "commonFilePathResolver", new CommonFilePathResolver());
        ReflectionTestUtils.setField(iconService, "filesService", metadataService);
        ReflectionTestUtils.setField(iconService, "sequenceService", sequenceService);
        UserAvatarApplicationService avatarService = new UserAvatarApplicationService(iconService, usersMapper);

        String url = avatarService.uploadAvatar(image());

        ArgumentCaptor<StorageLocation> location = ArgumentCaptor.forClass(StorageLocation.class);
        verify(storage).write(location.capture(), any(), any());
        assertThat(location.getValue().getBucketOrRoot()).isEqualTo("byai-icon");
        assertThat(url).isEqualTo("/commonFile/preview?style=minio&bucketName=byai-icon&filePath="
            + location.getValue().getPath());
        verify(usersMapper).update(isNull(), updateCaptor.capture());
        assertThat(updateCaptor.getValue().getParamNameValuePairs().values()).contains(url);
        ArgumentCaptor<Files> metadata = ArgumentCaptor.forClass(Files.class);
        verify(metadataService).save(metadata.capture());
        assertThat(metadata.getValue().getFileUrl()).isEqualTo(url);
    }

    @Test
    void missingUserDoesNotUpload() {
        assertThatThrownBy(() -> service.uploadAvatar(image())).isInstanceOf(BaseException.class);
        verifyNoInteractions(filesService);
    }

    @Test
    void emptyFileIsRejectedBeforeStorage() {
        MockMultipartFile file = new MockMultipartFile("file", "avatar.png", "image/png", new byte[0]);
        assertThatThrownBy(() -> service.uploadAvatar(file)).isInstanceOf(BaseException.class);
        verifyNoInteractions(filesService, usersMapper);
    }

    @Test
    void unsupportedTypeIsRejectedBeforeStorage() {
        MockMultipartFile file = new MockMultipartFile("file", "avatar.svg", "image/svg+xml", new byte[] {1});
        assertThatThrownBy(() -> service.uploadAvatar(file)).isInstanceOf(BaseException.class);
        verifyNoInteractions(filesService, usersMapper);
    }

    @Test
    void oversizedFileIsRejectedBeforeReadingBytes() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(5L * 1024 * 1024 + 1);
        assertThatThrownBy(() -> service.uploadAvatar(file)).isInstanceOf(BaseException.class);
        verifyNoInteractions(filesService, usersMapper);
    }

    @Test
    void failedStorageDoesNotUpdateUser() throws Exception {
        activeUser();
        when(filesService.uploadIcon(any())).thenThrow(new IOException("storage unavailable"));

        assertThatThrownBy(() -> service.uploadAvatar(image())).isInstanceOf(IOException.class);
        verify(usersMapper, never()).update(isNull(), any());
    }

    @Test
    void failedDatabaseUpdateDoesNotReturnSuccess() throws Exception {
        activeUser();
        storedIcon();
        when(usersMapper.update(isNull(), any())).thenReturn(0);

        assertThatThrownBy(() -> service.uploadAvatar(image())).isInstanceOf(BaseException.class);
        verify(usersMapper).update(isNull(), any());
    }

    private void activeUser() {
        Users user = new Users();
        user.setUserId(1001L);
        user.setState("A");
        user.setAvatar("previous-avatar");
        when(usersMapper.selectById(1001L)).thenReturn(user);
    }

    private void storedIcon() throws IOException {
        Files stored = new Files();
        stored.setFileUrl(URL);
        when(filesService.uploadIcon(any())).thenReturn(stored);
    }

    private MultipartFile image() {
        return new MockMultipartFile("file", "我的头像 & 新照片.png", "image/png", new byte[] {1, 2, 3});
    }
}
