package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class DangerousScriptGuardTest extends I18nTestSupport {
    @Test
    void localizesTheReasonAtDetectionTimeWithoutChangingTheSafetyRule() {
        DangerousScriptGuard guard = new DangerousScriptGuard();
        assertThat(guard.detect(null, "mkfs.ext4 /dev/sda"))
            .isEqualTo("脚本:检测到高危命令 — 磁盘格式化命令(mkfs)");
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(guard.detect(null, "mkfs.ext4 /dev/sda"))
            .isEqualTo("Script: dangerous command detected — Disk formatting command (mkfs)");
        assertThat(guard.detect("自定义阶段", "mkfs.ext4 /dev/sda"))
            .startsWith("自定义阶段: dangerous command detected");
        assertThat(guard.detect("stage", "echo ready")).isNull();
    }
}
