package com.iwhalecloud.byai.state.interfaces.controller.chat;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.state.application.service.asr.HarnessMediaClient;
import com.iwhalecloud.byai.state.application.service.asr.VoiceAudioService;
import com.iwhalecloud.byai.state.interfaces.controller.chat.VoiceController.TranscribeRequest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class VoiceControllerTest extends I18nTestSupport {
    @Mock private VoiceAudioService audio;
    @Mock private HarnessMediaClient media;
    private VoiceController controller;

    @BeforeEach
    void setUp() {
        controller = new VoiceController(audio, media);
    }

    @Test
    void uploadedFileUsesTheExistingGlobalAsrRoute() {
        var source = new VoiceAudioService.VoiceAudio(1L, 100L, "voice.mp3", new byte[] {'I', 'D', '3'});
        when(audio.load(1L, 100L)).thenReturn(source);
        when(media.transcribe(source, null)).thenReturn(Map.of("text", "recognized input"));
        assertThat(controller.transcribe(new TranscribeRequest(1L, 100L)).getData())
            .containsEntry("text", "recognized input");
        verify(audio).load(1L, 100L);
    }

    @Test
    void summaryArtifactUsesAuthorizedBytesAndTheSameGlobalAsrRoute() {
        String path = "/by/.sessions/100/tts/summary.mp3";
        var source = new VoiceAudioService.VoiceAudio(null, 100L, "summary.mp3", new byte[] {'I', 'D', '3'});
        when(audio.loadArtifact(100L, path)).thenReturn(source);
        when(media.transcribe(source, null)).thenReturn(Map.of("text", "recognized summary"));
        assertThat(controller.transcribe(new TranscribeRequest(null, 100L, path)).getData())
            .containsEntry("text", "recognized summary");
        verify(media).transcribe(source, null);
    }

    @Test
    void missingAndMixedSourcesFailBeforeLoadingOrCallingTheProvider() {
        for (TranscribeRequest request : List.of(new TranscribeRequest(null, null),
            new TranscribeRequest(null, null, "/by/.sessions/100/tts/a.mp3"),
            new TranscribeRequest(1L, 100L, "/by/.sessions/100/tts/a.mp3"))) {
            assertThatThrownBy(() -> controller.transcribe(request)).hasMessageContaining("400");
        }
        verifyNoInteractions(audio, media);
    }

    @Test
    void invalidDurationFailsBeforeLoadingEitherSource() {
        for (Number duration : List.<Number>of(0, -1, 300001, 1.5, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertThatThrownBy(() -> controller.transcribe(new TranscribeRequest(null, 100L,
                "/by/.sessions/100/tts/a.mp3", duration))).hasMessageContaining("400");
        }
        verifyNoInteractions(audio, media);
    }
}
