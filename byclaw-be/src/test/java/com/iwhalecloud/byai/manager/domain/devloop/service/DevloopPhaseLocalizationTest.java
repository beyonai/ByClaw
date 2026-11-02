package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class DevloopPhaseLocalizationTest extends I18nTestSupport {
    @Test
    void relocalizesCachedPhaseLabelsWithoutChangingProgressOrCustomContent() {
        var service = new DevloopPhaseService();
        var snapshot = service.emptySnapshot();
        snapshot.getPhases().get(0).setStatus("done");
        String cached = service.toJson(snapshot);
        LocaleContextHolder.setLocale(Locale.US);
        var english = service.fromJson(cached);
        assertThat(english.getPhases().get(0).getLabel()).isNotEqualTo(snapshot.getPhases().get(0).getLabel());
        assertThat(english.getPhases().get(0).getKey()).isEqualTo("issue");
        assertThat(english.getPhases().get(0).getStatus()).isEqualTo("done");
        assertThat(service.progressPercent(english)).isEqualTo(service.progressPercent(snapshot));
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(service.fromJson(cached).getPhases().get(0).getLabel()).isEqualTo(snapshot.getPhases().get(0).getLabel());
        var custom = service.fromJson("{\"phases\":[{\"key\":\"custom\",\"label\":\"用户环节\",\"status\":\"pending\"}]}");
        assertThat(custom.getPhases().get(0).getLabel()).isEqualTo("用户环节");
        assertThat(service.fromJson("null")).isNull();
    }
}
