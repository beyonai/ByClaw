package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import com.iwhalecloud.byai.state.application.service.asr.HarnessMediaClient;
import com.iwhalecloud.byai.state.application.service.asr.VoiceAudioService;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ModelDebugSpeechApplicationServiceTest extends I18nTestSupport {
    @org.junit.jupiter.api.BeforeEach
    void useEnglishMessages() {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
    }

    @Mock private VoiceAudioService audio;
    @Mock private HarnessMediaClient asr;
    @Mock private ModelManagementApplicationService management;
    @InjectMocks private ModelDebugSpeechApplicationService service;

    @Test
    void savedAsrModelDebugUsesOwnedAudioAndThePluginAdapter() {
        ModelVO model = new ModelVO();
        model.setModelType("ASR");
        model.setProviderName("QWEN");
        model.setModelProtocol("QWEN_ASR");
        model.setModelCode("qwen3-asr-flash");
        model.setApiEndpoint("https://asr.invalid/v1");
        model.setApiToken("test-provider-token");
        when(management.getModelDetail("55")).thenReturn(model);
        var source = new VoiceAudioService.VoiceAudio(1L, 100L, "voice.mp3", new byte[] {'I', 'D', '3'});
        when(audio.load(1L, null)).thenReturn(source);
        when(asr.transcribe(eq(source), any())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked") var config = (Map<String, Object>) invocation.getArgument(1);
            assertThat(config).containsEntry("provider", "QWEN").containsEntry("protocol", "QWEN_ASR")
                .containsEntry("apiKey", "test-provider-token");
            return Map.of("text", "test recognition");
        });
        assertThat(service.debugAsr(new ModelDebugSpeechApplicationService.DebugRequest("55", 1L, null, null)))
            .containsEntry("text", "test recognition");
    }

    @Test
    void explicitConfigMustBeCompleteWithoutDisclosingSecretsOnFailure() {
        assertThatThrownBy(() -> service.debugAsr(new ModelDebugSpeechApplicationService.DebugRequest(null, 1L, null,
            Map.of("apiKey", "test-secret-token"))))
            .hasMessageContaining("400").hasMessageNotContaining("test-secret-token");
        verifyNoInteractions(audio, asr, management);
    }

    @Test
    void ttsDebugUsesSavedOptionsAndHasADefaultProbeText() {
        ModelVO model = new ModelVO();
        model.setModelType("TTS");
        model.setProviderName("MINIMAX");
        model.setModelProtocol("MINIMAX_TTS");
        model.setModelCode("speech-test");
        model.setApiEndpoint("https://tts.invalid/v1");
        model.setApiToken("test-provider-token");
        model.setExtendParam("{\"voice\":\"test-voice\"}");
        when(management.getModelDetail("55")).thenReturn(model);
        when(asr.debugTts(any(), any())).thenAnswer(invocation -> {
            assertThat((String) invocation.getArgument(0)).isNotBlank();
            Map<?, ?> config = invocation.getArgument(1);
            assertThat((Map<String, Object>) config.get("options")).containsEntry("voice", "test-voice");
            return Map.of("success", true);
        });
        assertThat(service.debugTts(new ModelDebugSpeechApplicationService.TtsDebugRequest("55", null, null)))
            .containsEntry("success", true);
        verifyNoInteractions(audio);
    }

    @Test
    void savedNonAsrModelCannotBeDebuggedAsAsr() {
        ModelVO model = new ModelVO();
        model.setModelType("LLM");
        when(management.getModelDetail("55")).thenReturn(model);
        assertThatThrownBy(() -> service.debugAsr(new ModelDebugSpeechApplicationService.DebugRequest("55", 1L, null, null)))
            .hasMessageContaining("400");
        verifyNoInteractions(audio, asr);
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(value = {
        "zh-CN|你好，这是语音合成模型调试。",
        "en-US|Hello, this is a speech synthesis model test."
    }, delimiter = '|')
    void defaultSpeechSampleUsesTheRequestLanguage(String language, String expected) {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.forLanguageTag(language));
        Map<String, Object> config = Map.of("provider", "TEST", "protocol", "TEST_TTS", "model", "test",
            "endpoint", "https://example.com/tts", "apiKey", "test-token");
        service.debugTts(new ModelDebugSpeechApplicationService.TtsDebugRequest(null, null, config));
        org.mockito.Mockito.verify(asr).debugTts(eq(expected), any());
    }

}
