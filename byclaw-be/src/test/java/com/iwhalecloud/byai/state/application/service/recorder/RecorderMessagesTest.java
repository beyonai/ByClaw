package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RecorderMessagesTest extends I18nTestSupport {
    @Test
    void preservesStatusAndErrorCodesWhileLocalizingSynchronousValidation() {
        var service = service(new RecorderRequestRegistry());
        var chinese = service.bind(Map.of("mode", "invalid"));
        assertThat(chinese.status()).isEqualTo(400);
        assertThat(chinese.body().error().code()).isEqualTo("validation_failed");
        assertThat(chinese.body().error().message()).isEqualTo("绑定模式无效");
        LocaleContextHolder.setLocale(Locale.US);
        var english = service.bind(Map.of("mode", "invalid"));
        assertThat(english.status()).isEqualTo(400);
        assertThat(english.body().error().code()).isEqualTo("validation_failed");
        assertThat(english.body().error().message()).isEqualTo("invalid bind mode");
    }

    @Test
    void translatesAsyncErrorsForTheViewerWithoutMutatingTheStoredResult() {
        var registry = new RecorderRequestRegistry();
        var owner = new RecorderOwner(1L, "alice");
        registry.createRunning("req-1", "verify", owner);
        var error = Map.<String, Object>of("code", "verify_timeout", "message", "verify runner timed out",
            "details", Map.of("message", "verify runner timed out"));
        registry.finalizeRequest("req-1", "timeout", null, error);
        var service = service(registry);
        var chinese = service.requestStatus("req-1").body().data();
        assertThat(chinese).containsEntry("status", "timeout");
        assertThat((Map<String, Object>) chinese.get("error")).containsEntry("message", "验证执行超时")
            .containsEntry("details", error.get("details"));
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(service.requestStatus("req-1").body().data()).containsEntry("error", error);
        assertThat(registry.getOwned("req-1", owner).orElseThrow()).containsEntry("error", error);
    }

    @Test
    void translatesVerificationReasonsButLeavesScriptBodiesAndUnknownDiagnosticsIntact() {
        var verify = Map.<String, Object>of("ok", false, "reasons", List.of("rows 0 < expected 1000", "custom detail"));
        var draft = Map.<String, Object>of("draftId", "draft_001", "source", "pending verification", "verify", verify);
        var data = Map.<String, Object>of("result", Map.of("drafts", List.of(draft)));
        var translated = RecorderMessages.localizeResponse(data);
        var result = (Map<String, Object>) translated.get("result");
        var translatedDraft = (Map<String, Object>) ((List<?>) result.get("drafts")).get(0);
        assertThat(translatedDraft).containsEntry("source", "pending verification").containsEntry("draftId", "draft_001");
        assertThat((Map<String, Object>) translatedDraft.get("verify"))
            .containsEntry("reasons", List.of("行数 0 小于预期值 1000", "custom detail"));
        assertThat(draft).containsEntry("verify", verify);
        assertThat(RecorderMessages.localize("cannot verify from ranked")).isEqualTo("状态 ranked 不允许验证");
        assertThat(RecorderMessages.localize("vendor error: session not found")).isEqualTo("vendor error: session not found");
        assertThat(RecorderMessages.localize(null)).isNull();
        assertThat(RecorderMessages.localizeResponse(Map.of("verify", Map.of("reasons", List.of("pending verification")))))
            .containsEntry("verify", Map.of("reasons", List.of("pending verification")));
    }

    private RecorderApplicationService service(RecorderRequestRegistry registry) {
        var users = mock(RecorderCurrentUserProvider.class);
        when(users.requireCurrent()).thenReturn(new RecorderOwner(1L, "alice"));
        return new RecorderApplicationService(new RecorderSessionRegistry(), registry, mock(RecorderRankService.class),
            mock(RecorderPipelineService.class), mock(RecorderBrowserPort.class), mock(RecorderVncProvider.class),
            mock(RecorderVerifyService.class), mock(RecorderDraftStore.class), users,
            mock(RecorderResourceSaveService.class), mock(RecorderLlmService.class));
    }
}
