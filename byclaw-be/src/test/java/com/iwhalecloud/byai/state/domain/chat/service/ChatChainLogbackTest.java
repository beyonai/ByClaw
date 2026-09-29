package com.iwhalecloud.byai.state.domain.chat.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.joran.JoranConfigurator;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.spi.FilterReply;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;

class ChatChainLogbackTest {
    @TempDir Path directory;
    @Test
    void bothConfigurationsKeepWarnAndFilterBeforeErrorQueue() throws Exception {
        int index = 0;
        for (Path file : new Path[] { Path.of("config/logback.xml"), Path.of("../deploy/config/logback.xml") }) {
            LoggerContext context = new LoggerContext();
            try {
                // Resolve Spring-only properties without starting the application or connecting Redis.
                String xml = Files.readString(file)
                    .replaceAll("<springProperty[^>]+/>", "")
                    .replace("${appName}${port}", "test")
                    .replace("value=\"logs\"", "value=\"" + directory.resolve("logs" + index++) + "\"");
                JoranConfigurator configurator = new JoranConfigurator();
                configurator.setContext(context);
                configurator.doConfigure(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
                assertThat(context.getStatusManager().getCopyOfStatusList().stream()
                    .filter(status -> status.getLevel() == 2).toList()).isEmpty();
                assertThat(context.getLogger(SessionStreamManager.class).isWarnEnabled()).isTrue();
                assertThat(context.getLogger(ChatChainLog.class).isInfoEnabled()).isTrue();
                var appender = context.getLogger("ROOT").getAppender("ASYNC_ERROR");
                assertThat(appender.isStarted()).isTrue();
                LoggingEvent event = new LoggingEvent();
                event.setLevel(Level.INFO);
                assertThat(appender.getFilterChainDecision(event)).isEqualTo(FilterReply.DENY);
                event = new LoggingEvent();
                event.setLevel(Level.ERROR);
                assertThat(appender.getFilterChainDecision(event)).isNotEqualTo(FilterReply.DENY);
            } finally { context.stop(); }
        }
    }
}
