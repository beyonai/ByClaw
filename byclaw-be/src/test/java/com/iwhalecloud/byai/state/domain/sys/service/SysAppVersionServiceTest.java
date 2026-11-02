package com.iwhalecloud.byai.state.domain.sys.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.util.FileUtil;
import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import com.iwhalecloud.byai.manager.mapper.system.SysAppVersionMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

class SysAppVersionServiceTest extends I18nTestSupport {

    private SysAppVersionMapper sysAppVersionMapper;
    private FileIngressService fileIngressService;
    private SysAppVersionService service;

    @BeforeEach
    void setUp() {
        sysAppVersionMapper = mock(SysAppVersionMapper.class);
        fileIngressService = mock(FileIngressService.class);
        service = new SysAppVersionService();
        ReflectionTestUtils.setField(service, "sysAppVersionMapper", sysAppVersionMapper);
        ReflectionTestUtils.setField(service, "fileIngressService", fileIngressService);
    }

    @Test
    void downloadPackageRestoresPackageBucketForRawObjectPath() throws Exception {
        long versionId = 20096802L;
        String objectPath = "/file/user_10001/20260923/鲸智百应-0.1.1-arm64.dmg";
        String storageUrl = FileUtil.generateFileAccessUrl(Constants.BUCKET_NAME_PACKAGE, objectPath, "file");
        SysAppVersion version = new SysAppVersion();
        version.setVersionId(versionId);
        version.setUrl(objectPath);
        version.setFileName("鲸智百应-0.1.1-arm64.dmg");
        version.setFileSize(7L);
        when(sysAppVersionMapper.selectById(versionId)).thenReturn(version);
        when(fileIngressService.downloadFile(storageUrl))
            .thenReturn(new ByteArrayInputStream("package".getBytes(StandardCharsets.UTF_8)));
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.downloadPackage(versionId, response);

        verify(fileIngressService).downloadFile(storageUrl);
        assertThat(response.getContentAsByteArray()).isEqualTo("package".getBytes(StandardCharsets.UTF_8));
        assertThat(response.getContentType()).isEqualTo("application/octet-stream");
        assertThat(response.getContentLengthLong()).isEqualTo(7L);
    }

    @Test
    void missingPackageKeepsNotFoundStatusAndUsesRequestLocale() {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.downloadPackage(404L, new MockHttpServletResponse()))
            .isInstanceOfSatisfying(org.springframework.web.server.ResponseStatusException.class, error -> {
                assertThat(error.getStatusCode().value()).isEqualTo(404);
                assertThat(error.getReason()).isEqualTo("Package not found");
            });
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.SIMPLIFIED_CHINESE);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.downloadPackage(404L, new MockHttpServletResponse()))
            .isInstanceOfSatisfying(org.springframework.web.server.ResponseStatusException.class, error -> {
                assertThat(error.getStatusCode().value()).isEqualTo(404);
                assertThat(error.getReason()).isEqualTo("安装包不存在");
            });
    }
}
