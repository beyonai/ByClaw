package com.iwhalecloud.byai.manager.interfaces.controller.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.aimodel.ModelDebugSpeechApplicationService;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelDebugSpeechApplicationService.DebugRequest;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelDebugSpeechApplicationService.TtsDebugRequest;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.state.application.service.asr.HarnessMediaClient.ModelFailureException;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.http.HttpStatusCode;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class ModelSpeechDebugStatusTest {
    @Mock private ModelManagementApplicationService management;
    @Mock private ModelDebugSpeechApplicationService speech;
    private ModelManagementController controller;
    private final DebugRequest request = new DebugRequest("55", 1L, null, null);

    @BeforeEach
    void setUp() {
        controller = new ModelManagementController();
        ReflectionTestUtils.setField(controller, "modelManagementApplicationService", management);
        ReflectionTestUtils.setField(controller, "modelDebugSpeechApplicationService", speech);
        when(management.parseModelIdFromBody(any())).thenReturn(55L);
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 413, 422, 502, 503})
    void invalidInputSilenceAndRuntimeAvailabilityDoNotChangeSavedAsrStatus(int status) {
        var failure = new ResponseStatusException(HttpStatusCode.valueOf(status), "input or runtime failure");
        when(speech.debugAsr(request)).thenThrow(failure);

        assertThatThrownBy(() -> controller.debugModelAsr(request)).isSameAs(failure);

        verify(management, never()).updateModelStatusAfterDebug(anyLong(), anyBoolean());
    }

    @Test
    void unexpectedProgrammingFailureDoesNotDisableAnAsrModel() {
        var failure = new IllegalStateException("unrelated failure");
        when(speech.debugAsr(request)).thenThrow(failure);
        assertThatThrownBy(() -> controller.debugModelAsr(request)).isSameAs(failure);
        verify(management, never()).updateModelStatusAfterDebug(anyLong(), anyBoolean());
    }

    @Test
    void confirmedProviderFailureUpdatesTheSavedAsrStatus() {
        var failure = new ModelFailureException();
        when(speech.debugAsr(request)).thenThrow(failure);
        assertThatThrownBy(() -> controller.debugModelAsr(request)).isSameAs(failure);
        verify(management).updateModelStatusAfterDebug(55L, false);
    }

    @Test
    void successfulAsrDebugStillEnablesTheSavedModel() {
        when(speech.debugAsr(request)).thenReturn(Map.of("text", "recognized speech"));
        assertThat(controller.debugModelAsr(request).getData()).isEqualTo(Map.of("text", "recognized speech"));
        verify(management).updateModelStatusAfterDebug(55L, true);
    }

    @Test
    void invalidTtsInputDoesNotChangeTheSavedModelStatus() {
        var tts = new TtsDebugRequest("55", "x".repeat(1001), null);
        when(speech.debugTts(tts)).thenThrow(new ResponseStatusException(HttpStatusCode.valueOf(400)));
        assertThatThrownBy(() -> controller.debugModelTts(tts)).isInstanceOf(ResponseStatusException.class);
        verify(management, never()).updateModelStatusAfterDebug(anyLong(), anyBoolean());
    }

    @Test
    void confirmedTtsProviderFailureStillUpdatesTheSavedModelStatus() {
        var tts = new TtsDebugRequest("55", "hello", null);
        when(speech.debugTts(tts)).thenThrow(new ModelFailureException());
        assertThatThrownBy(() -> controller.debugModelTts(tts)).isInstanceOf(ModelFailureException.class);
        verify(management).updateModelStatusAfterDebug(55L, false);
    }
}
