package com.iwhalecloud.byai.state.application.service.asr;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.state.application.service.chat.ChatFileArtifactApplicationService;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService.FsDownload;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class VoiceAudioServiceTest extends I18nTestSupport {
    @org.junit.jupiter.api.BeforeEach
    void useEnglishMessages() {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
    }

    @Mock private FilesService files;
    @Mock private FilesApplicationService storage;
    @Mock private ChatFileArtifactApplicationService artifacts;
    @InjectMocks private VoiceAudioService service;

    @BeforeEach
    void login() {
        LoginInfo login = new LoginInfo();
        login.setUserId(42L);
        login.setUserCode("user42");
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void rejectsAnonymousAndOtherUsersFilesBeforeReadingStorage() {
        Files other = file();
        other.setCreateBy(99L);
        when(files.findById(1L)).thenReturn(other);
        assertThatThrownBy(() -> service.load(1L, null)).isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("404");
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.load(1L, null)).hasMessageContaining("401");
        verifyNoInteractions(storage);
    }

    @Test
    void rejectsSessionMismatchAndRemoteOrInvalidReferences() {
        Files file = file();
        when(files.findById(1L)).thenReturn(file);
        assertThatThrownBy(() -> service.load(1L, 200L)).hasMessageContaining("403");
        file.setFileUrl("https://evil.invalid/commonFile/preview?filePath=secret");
        assertThatThrownBy(() -> service.load(1L, 100L)).hasMessageContaining("Invalid uploaded voice");
        verifyNoInteractions(storage);
    }

    @Test
    void enforcesActualReadLimitEvenWhenMetadataOmitsLength() {
        when(files.findById(1L)).thenReturn(file());
        when(storage.openCommonFileInputStream("byclaw-user42", "/100/voice.mp3"))
            .thenReturn(new ByteArrayInputStream(new byte[VoiceAudioService.MAX_AUDIO_BYTES + 1]));
        assertThatThrownBy(() -> service.load(1L, null)).hasMessageContaining("413");
    }

    @Test
    void rejectsRenamedNonAudioFiles() {
        when(files.findById(1L)).thenReturn(file());
        when(storage.openCommonFileInputStream("byclaw-user42", "/100/voice.mp3"))
            .thenReturn(new ByteArrayInputStream("not mp3".getBytes()));
        assertThatThrownBy(() -> service.load(1L, null)).hasMessageContaining("Invalid MP3");
    }

    @Test
    void replacesClientBytesAndPersistsOnlySanitizedMetadata() {
        when(files.findById(1L)).thenReturn(file());
        byte[] mp3 = new byte[] { 'I', 'D', '3', 1, 2, 3 };
        when(storage.openCommonFileInputStream("byclaw-user42", "/100/voice.mp3"))
            .thenAnswer(invocation -> new ByteArrayInputStream(mp3));
        Map<String, Object> voice = Map.of("fileId", "1", "durationMs", 1234, "audioBase64", "forged",
            "fileUrl", "https://evil.invalid", "transcript", "forged transcript");
        AssistantChatDto chat = new AssistantChatDto();
        chat.setSessionId(100L);
        chat.setExtParams(Map.of("voice", voice, "audioBase64", "forged"));
        service.prepareChat(chat);
        assertThat(chat.getMetadata()).doesNotContain("VOICE", "voice", "forged", "audioBase64", "evil.invalid");
        assertThat(JSON.toJSONString(chat.getExtParams())).contains("VOICE", "durationMs").doesNotContain("forged", "audioBase64", "evil.invalid");
        @SuppressWarnings("unchecked")
        var persistedVoice = (Map<String, Object>) chat.getExtParams().get("voice");
        Map<String, Object> outbound = service.outbound(persistedVoice, 100L);
        assertThat(outbound).containsEntry("audioBase64", Base64.getEncoder().encodeToString(mp3));
        assertThat(persistedVoice).doesNotContainKey("audioBase64");
    }

    @Test
    void summaryArtifactReusesAuthorizedSessionDownloadAndServerBytes() {
        byte[] mp3 = new byte[] {'I', 'D', '3', 1, 2};
        String path = "/by/.sessions/100/tts/summary.mp3";
        when(artifacts.download(100L, path)).thenReturn(new FsDownload("summary.mp3", "audio/mpeg",
            output -> output.write(mp3)));
        var result = service.loadArtifact(100L, path);
        assertThat(result.fileId()).isNull();
        assertThat(result.sessionId()).isEqualTo(100L);
        assertThat(result.bytes()).containsExactly(mp3);
        verifyNoInteractions(files, storage);
    }

    @Test
    void artifactLoaderRejectsAnonymousRemoteAndHostSourcesBeforeStorage() {
        for (String path : new String[] {"https://other.invalid/summary.mp3", "file:///tmp/summary.mp3",
            "/tmp/storage/by/.sessions/100/tts/summary.mp3"}) {
            assertThatThrownBy(() -> service.loadArtifact(100L, path)).hasMessageContaining("400");
        }
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.loadArtifact(100L, "/by/.sessions/100/tts/summary.mp3"))
            .hasMessageContaining("401");
        verifyNoInteractions(artifacts, files, storage);
    }

    @Test
    void artifactLoaderRetainsSessionAuthorizationFailures() {
        String path = "/by/.sessions/200/tts/private.mp3";
        when(artifacts.download(100L, path)).thenThrow(new ResponseStatusException(
            org.springframework.http.HttpStatus.FORBIDDEN, "chat.file.artifact.path.not.in.session"));
        assertThatThrownBy(() -> service.loadArtifact(100L, path)).hasMessageContaining("403");
        verifyNoInteractions(files, storage);
    }

    @Test
    void artifactLoaderEnforcesActualByteLimitAndMp3Format() {
        String path = "/by/.sessions/100/tts/summary.mp3";
        when(artifacts.download(100L, path)).thenReturn(new FsDownload("summary.mp3", "audio/mpeg",
            output -> output.write(new byte[VoiceAudioService.MAX_AUDIO_BYTES + 1])));
        assertThatThrownBy(() -> service.loadArtifact(100L, path)).hasMessageContaining("413");
        when(artifacts.download(100L, path)).thenReturn(new FsDownload("summary.mp3", "audio/mpeg",
            output -> output.write("not mp3".getBytes())));
        assertThatThrownBy(() -> service.loadArtifact(100L, path)).hasMessageContaining("Invalid MP3");
        when(artifacts.download(100L, path)).thenReturn(new FsDownload("image.png", "image/png",
            output -> { throw new AssertionError("Non-MP3 artifacts must not be read"); }));
        assertThatThrownBy(() -> service.loadArtifact(100L, path)).hasMessageContaining("must be MP3");
    }

    private Files file() {
        Files file = new Files();
        file.setFileId(1L);
        file.setCreateBy(42L);
        file.setChatId(100L);
        file.setFileName("voice.mp3");
        file.setContentType("audio/mpeg");
        file.setFileUrl("/commonFile/preview?style=minio&bucketName=byclaw-user42&filePath=/100/voice.mp3");
        return file;
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(value = {
        "zh-CN|fileId 不能为空|语音时长必须为 1 至 300000 毫秒",
        "en-US|fileId is required|Voice duration must be 1 to 300000 milliseconds"
    }, delimiter = '|')
    void invalidVoiceInputUsesTheCurrentLanguageWithoutReadingStorage(String language, String fileId, String duration) {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.forLanguageTag(language));
        assertThatThrownBy(() -> service.load(null, null)).isInstanceOfSatisfying(ResponseStatusException.class, error -> {
            assertThat(error.getStatusCode().value()).isEqualTo(400);
            assertThat(error.getReason()).isEqualTo(fileId);
        });
        assertThatThrownBy(() -> VoiceAudioService.validateDuration(0)).isInstanceOfSatisfying(ResponseStatusException.class, error -> {
            assertThat(error.getStatusCode().value()).isEqualTo(400);
            assertThat(error.getReason()).isEqualTo(duration);
        });
        verifyNoInteractions(files, storage, artifacts);
    }

}
