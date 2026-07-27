package com.iwhalecloud.byai.common.storage.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.config.FtpConfig;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.Session;

class SftpStorageServiceTest {

    @Test
    void put_mapsLogicalStorageLocationToConfiguredSftpRoot() throws Exception {
        Session session = mock(Session.class);
        ChannelSftp channelSftp = mock(ChannelSftp.class);
        when(session.openChannel("sftp")).thenReturn(channelSftp);
        when(session.isConnected()).thenReturn(true);
        when(channelSftp.isConnected()).thenReturn(true);
        TestableSftpStorageService storageService = storageService(session);

        FileMetadata metadata = storageService.put(StorageLocation.of("common-file", "byai-feedback",
            "/manager001/error.png"), new ByteArrayInputStream("content".getBytes(StandardCharsets.UTF_8)), 7L,
            "image/png");

        verify(channelSftp).put(any(InputStream.class), eq("/data/byai/byai-feedback/manager001/error.png"));
        assertThat(metadata.getFileName()).isEqualTo("error.png");
        assertThat(metadata.getBucketName()).isEqualTo("byai-feedback");
        assertThat(metadata.getFileUrl()).contains("bucketName=byai-feedback").contains("fileName=/manager001/error.png");
    }

    @Test
    void get_keepsSftpConnectionOpenUntilReturnedStreamIsClosed() throws Exception {
        Session session = mock(Session.class);
        ChannelSftp channelSftp = mock(ChannelSftp.class);
        when(session.openChannel("sftp")).thenReturn(channelSftp);
        when(session.isConnected()).thenReturn(true);
        when(channelSftp.isConnected()).thenReturn(true);
        when(channelSftp.get("/data/byai/byai-feedback/manager001/error.png"))
            .thenReturn(new ByteArrayInputStream("content".getBytes(StandardCharsets.UTF_8)));
        TestableSftpStorageService storageService = storageService(session);

        try (InputStream inputStream = storageService.get(StorageLocation.of("common-file", "byai-feedback",
            "/manager001/error.png"))) {
            assertThat(inputStream.readAllBytes()).isEqualTo("content".getBytes(StandardCharsets.UTF_8));
        }

        verify(channelSftp).disconnect();
        verify(session).disconnect();
    }

    private TestableSftpStorageService storageService(Session session) {
        TestableSftpStorageService storageService = new TestableSftpStorageService(session);
        FtpConfig ftpConfig = new FtpConfig();
        ftpConfig.setPath("/data/byai");
        ReflectionTestUtils.setField(storageService, "ftpConfig", ftpConfig);
        return storageService;
    }

    private static final class TestableSftpStorageService extends SftpStorageService {

        private final Session session;

        private TestableSftpStorageService(Session session) {
            this.session = session;
        }

        @Override
        protected Session createStorageClient() {
            return session;
        }
    }
}
