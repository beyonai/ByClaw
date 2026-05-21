package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawPersonalAgentArchiveDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertIterableEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ByClawPersonalAgentArchivApplicationServiceTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    private static final String ROOT = "/.personal-agents/10000417/";

    private static final String ARCHIVE_PATH = ROOT + "assistant-demo.tar.gz";

    @Mock
    private UserFS userFS;

    private ByClawPersonalAgentArchivApplicationService service;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("resource.resourceid.notnull", Locale.SIMPLIFIED_CHINESE, "资源ID不能为空");
        messageSource.addMessage("byclaw.personal.agent.archive.empty", Locale.SIMPLIFIED_CHINESE, "tar.gz不能为空");
        messageSource.addMessage("byclaw.personal.agent.archive.file.invalid", Locale.SIMPLIFIED_CHINESE,
            "必须上传tar.gz文件");
        messageSource.addMessage("byclaw.personal.agent.archive.path.invalid", Locale.SIMPLIFIED_CHINESE,
            "路径必须位于 /.personal-agents/{resourceId}/ 之下");
        messageSource.addMessage("byclaw.personal.agent.archive.notfound", Locale.SIMPLIFIED_CHINESE,
            "tar.gz文件不存在或已被删除");
        messageSource.addMessage("byclaw.fs.write.file.failed", Locale.SIMPLIFIED_CHINESE, "写入失败: {0}");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        service = new ByClawPersonalAgentArchivApplicationService();
        ReflectionTestUtils.setField(service, "userFS", userFS);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void shouldUploadTarGzUsingOriginalFilenameAndOverwriteSameName() {
        MockMultipartFile file = new MockMultipartFile("file", "assistant-demo.tar.gz", "application/gzip",
            "demo".getBytes());
        FileMetadata metadata = new FileMetadata();
        metadata.setFileSize(4L);
        metadata.setContentType("application/gzip");
        when(userFS.write(any(ByteArrayInputStream.class), anyLong(), anyString(), anyString())).thenReturn(metadata);

        ByClawPersonalAgentArchiveDto dto = service.uploadTarGz(USER_CODE, RESOURCE_ID, file);

        verify(userFS).init();
        verify(userFS).delete(ARCHIVE_PATH);
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS).write(any(ByteArrayInputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertEquals(ARCHIVE_PATH, pathCaptor.getValue());
        assertEquals("assistant-demo.tar.gz", dto.getFileName());
        assertEquals(ARCHIVE_PATH, dto.getArchivePath());
        assertEquals("/by" + ARCHIVE_PATH, dto.getObjectKey());
    }

    @Test
    void shouldRejectNonTarGzUpload() {
        MockMultipartFile file = new MockMultipartFile("file", "assistant-demo.zip", "application/zip",
            "demo".getBytes());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadTarGz(USER_CODE, RESOURCE_ID, file));

        assertEquals("必须上传tar.gz文件", ex.getMessage());
    }

    @Test
    void shouldQueryOnlyRootLevelTarGzFilesAndSortByName() {
        when(userFS.list(eq(ROOT), isNull())).thenReturn(Arrays.asList(
            ROOT + "zeta.tar.gz",
            ROOT + "nested/alpha.tar.gz",
            ROOT + "alpha.tar.gz",
            ROOT + "README.md"));

        List<ByClawPersonalAgentArchiveDto> result = service.queryTarGzList(USER_CODE, RESOURCE_ID, null);

        assertEquals(2, result.size());
        assertIterableEquals(List.of("alpha.tar.gz", "zeta.tar.gz"),
            result.stream().map(ByClawPersonalAgentArchiveDto::getFileName).toList());
        assertEquals(ROOT + "alpha.tar.gz", result.get(0).getArchivePath());
    }

    @Test
    void shouldFilterArchiveListByKeyword() {
        when(userFS.list(eq(ROOT), isNull())).thenReturn(Arrays.asList(
            ROOT + "alpha-agent.tar.gz",
            ROOT + "beta.tar.gz"));

        List<ByClawPersonalAgentArchiveDto> result = service.queryTarGzList(USER_CODE, RESOURCE_ID, "agent");

        assertEquals(1, result.size());
        assertEquals("alpha-agent.tar.gz", result.get(0).getFileName());
    }

    @Test
    void shouldStreamTarGzFileForDownload() throws IOException {
        byte[] content = "archive-demo".getBytes();
        when(userFS.list(eq(ARCHIVE_PATH), eq(1))).thenReturn(Collections.singletonList(ARCHIVE_PATH));
        when(userFS.read(eq(ARCHIVE_PATH))).thenReturn(new ByteArrayInputStream(content));

        ByClawPersonalAgentArchivApplicationService.PersonalAgentTarGzDownload download =
            service.prepareDownload(USER_CODE, RESOURCE_ID, ARCHIVE_PATH);

        assertEquals("assistant-demo.tar.gz", download.getFileName());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        download.getBody().writeTo(out);
        assertEquals("archive-demo", out.toString());
    }

    @Test
    void shouldRejectInvalidArchivePath() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.prepareDownload(USER_CODE, RESOURCE_ID, "/.personal-agents/10000417/nested/demo.tar.gz"));

        assertTrue(ex.getMessage().contains(".personal-agents"));
    }

    @Test
    void shouldDeleteTarGzWhenExists() {
        when(userFS.list(eq(ARCHIVE_PATH), eq(1))).thenReturn(Collections.singletonList(ARCHIVE_PATH));

        ByClawPersonalAgentArchiveDto dto = service.deleteTarGz(USER_CODE, RESOURCE_ID, ARCHIVE_PATH);

        verify(userFS).init();
        verify(userFS).delete(ARCHIVE_PATH);
        assertEquals("assistant-demo.tar.gz", dto.getFileName());
        assertEquals(ARCHIVE_PATH, dto.getArchivePath());
    }

    @Test
    void shouldRejectDeletingMissingArchive() {
        when(userFS.list(eq(ARCHIVE_PATH), eq(1))).thenReturn(Collections.emptyList());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.deleteTarGz(USER_CODE, RESOURCE_ID, ARCHIVE_PATH));

        assertEquals("tar.gz文件不存在或已被删除", ex.getMessage());
    }
}
