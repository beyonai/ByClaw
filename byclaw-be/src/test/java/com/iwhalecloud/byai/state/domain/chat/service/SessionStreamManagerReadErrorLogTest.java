package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.util.ConcurrentModificationException;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.serializer.SerializationException;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.ConsumerStreamReadRequest;
import org.springframework.test.util.ReflectionTestUtils;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

/**
 * 持续性读取异常下的日志抑制行为。
 * <p>
 * 读取异常不取消 subscription，NOGROUP 这类故障在人工修复前每轮轮询都会触发 errorHandler。
 * 这里验证日志按 stream 去重，而指标仍逐次累加。
 */
class SessionStreamManagerReadErrorLogTest {

    private static final String STREAM_KEY = "byai_gateway:session:10209077:data_stream";

    private SessionStreamManager manager;
    private SessionStreamMetrics metrics;
    private ListAppender<ILoggingEvent> appender;
    private Logger logger;

    @BeforeEach
    void setUp() {
        manager = new SessionStreamManager();
        metrics = mock(SessionStreamMetrics.class);
        ReflectionTestUtils.setField(manager, "sessionStreamMetrics", metrics);
        ReflectionTestUtils.setField(manager, "readErrorLogIntervalMillis", 60_000L);
        // 退避与去重相互独立，这里关掉退避以免单测为此空等。
        ReflectionTestUtils.setField(manager, "readErrorBackoffMillis", 0L);

        logger = (Logger) LoggerFactory.getLogger(SessionStreamManager.class);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.WARN);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
        appender.stop();
    }

    @Test
    void repeatedIdenticalReadErrorsAreLoggedOnceWithinTheSilenceWindow() {
        var errorHandler = errorHandler();
        for (int i = 0; i < 500; i++) {
            errorHandler.handleError(new RedisConnectionFailureException("NOGROUP No such key"));
        }

        assertThat(warnMessages()).hasSize(1);
        // 指标是聚合计数，必须反映真实故障速率，不参与日志去重。
        verify(metrics, times(500)).recordReadError(any(RedisConnectionFailureException.class));
    }

    @Test
    void aDifferentErrorTypeIsLoggedImmediatelyInsteadOfWaitingOutTheWindow() {
        var errorHandler = errorHandler();
        errorHandler.handleError(new RedisConnectionFailureException("down"));
        errorHandler.handleError(new RedisConnectionFailureException("down"));

        // 换了故障类型说明是另一个问题，不能被上一类异常的静默窗口盖掉。
        errorHandler.handleError(new SerializationException("bad payload"));

        assertThat(warnMessages()).hasSize(2);
        assertThat(warnMessages().get(1)).contains("SerializationException");
    }

    @Test
    void theSummaryAfterTheWindowCarriesTheSuppressedCount() {
        var errorHandler = errorHandler();
        errorHandler.handleError(new RedisConnectionFailureException("down"));
        for (int i = 0; i < 9; i++) {
            errorHandler.handleError(new RedisConnectionFailureException("down"));
        }

        // 让静默窗口到期，下一次异常应当汇总期间被抑制的次数。
        ReflectionTestUtils.setField(manager, "readErrorLogIntervalMillis", 0L);
        errorHandler.handleError(new RedisConnectionFailureException("down"));

        List<String> warns = warnMessages();
        assertThat(warns).hasSize(2);
        assertThat(warns.get(1)).contains("已抑制重复日志: 9 次");
    }

    @Test
    void restartingAListenerRestoresImmediateLogging() {
        var errorHandler = errorHandler();
        errorHandler.handleError(new RedisConnectionFailureException("down"));
        errorHandler.handleError(new RedisConnectionFailureException("down"));
        assertThat(warnMessages()).hasSize(1);

        manager.resetReadErrorLogState(STREAM_KEY);
        errorHandler.handleError(new RedisConnectionFailureException("down"));

        assertThat(warnMessages()).hasSize(2);
    }

    @Test
    void perStreamStateDoesNotAccumulateAfterTheListenerStops() {
        errorHandler().handleError(new RedisConnectionFailureException("down"));
        assertThat(readErrorLogStates()).containsKey(STREAM_KEY);

        manager.resetReadErrorLogState(STREAM_KEY);

        assertThat(readErrorLogStates()).isEmpty();
    }

    @Test
    void separateStreamsAreThrottledIndependently() {
        errorHandler().handleError(new RedisConnectionFailureException("down"));
        manager.createReadRequest("2", "other-stream", "consumer-2")
            .getErrorHandler().handleError(new RedisConnectionFailureException("down"));

        // 一个坏 session 不应让另一个 session 的首次故障失去告警。
        assertThat(warnMessages()).hasSize(2);
    }

    /**
     * Redis 抖动期间多种异常会交替出现。若「新类型即时打印」只与上一次的类型比较，
     * 交替就能让每一次异常都判定为新类型，从而整体绕过静默窗口，日志量重新失控。
     */
    @Test
    void alternatingErrorTypesDoNotBypassTheSilenceWindow() {
        var errorHandler = errorHandler();
        for (int i = 0; i < 200; i++) {
            errorHandler.handleError(i % 2 == 0
                ? new RedisConnectionFailureException("down")
                : new SerializationException("bad payload"));
        }

        // 两种类型各自的首次出现即时打印，其余全部落入静默窗口。
        assertThat(warnMessages()).hasSize(2);
    }

    /**
     * 新类型即时打印需要上限兜底，否则持续抛出互不相同的异常同样能刷满日志。
     */
    @Test
    void immediateLoggingOfNewErrorTypesIsCappedWithinOneWindow() {
        List<RuntimeException> distinctErrors = List.of(
            new RedisConnectionFailureException("a"),
            new SerializationException("b"),
            new QueryTimeoutException("c"),
            new IllegalStateException("d"),
            new IllegalArgumentException("e"),
            new UnsupportedOperationException("f"),
            new NumberFormatException("g"),
            new ArithmeticException("h"),
            new ClassCastException("i"),
            new ConcurrentModificationException("j"),
            new NullPointerException("k"),
            new NoSuchElementException("l"));
        var errorHandler = errorHandler();

        distinctErrors.forEach(errorHandler::handleError);

        assertThat(warnMessages()).hasSize(8);
    }

    /**
     * 间隔超过静默窗口的偶发异常不应被抑制，也不应被冠以「持续存在」的措辞。
     */
    @Test
    void sparseErrorsBeyondTheWindowKeepLoggingAsFirstOccurrences() {
        ReflectionTestUtils.setField(manager, "readErrorLogIntervalMillis", 0L);
        var errorHandler = errorHandler();

        for (int i = 0; i < 5; i++) {
            errorHandler.handleError(new RedisConnectionFailureException("down"));
        }

        assertThat(warnMessages()).hasSize(5);
        assertThat(warnMessages()).noneMatch(message -> message.contains("持续存在"));
    }

    /**
     * XREADGROUP 报错立即返回，poll task 不带退避就会紧接着重读，故障 session 退化为空转热循环。
     */
    @Test
    void readErrorsBackOffBeforeTheNextPoll() {
        ReflectionTestUtils.setField(manager, "readErrorBackoffMillis", 120L);
        var errorHandler = errorHandler();

        long startedAt = System.nanoTime();
        errorHandler.handleError(new RedisConnectionFailureException("down"));
        long elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000L;

        assertThat(elapsedMillis).isGreaterThanOrEqualTo(100L);
    }

    @Test
    void shutdownSkipsTheBackoffSoListenersStopPromptly() {
        ReflectionTestUtils.setField(manager, "readErrorBackoffMillis", 5_000L);
        ReflectionTestUtils.setField(manager, "shuttingDown", true);
        var errorHandler = errorHandler();

        long startedAt = System.nanoTime();
        errorHandler.handleError(new RedisConnectionFailureException("down"));
        long elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000L;

        assertThat(elapsedMillis).isLessThan(1_000L);
    }

    private org.springframework.util.ErrorHandler errorHandler() {
        ConsumerStreamReadRequest<String> request =
            manager.createReadRequest("10209077", STREAM_KEY, "consumer-1");
        return request.getErrorHandler();
    }

    @SuppressWarnings("unchecked")
    private Map<String, ?> readErrorLogStates() {
        return (Map<String, ?>) ReflectionTestUtils.getField(manager, "readErrorLogStates");
    }

    private List<String> warnMessages() {
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }
}
