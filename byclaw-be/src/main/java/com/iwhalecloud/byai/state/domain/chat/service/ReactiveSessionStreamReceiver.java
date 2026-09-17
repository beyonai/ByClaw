package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;
import reactor.core.scheduler.Schedulers;

/**
 * Reads the existing SDK Session Stream keys through Lettuce/Netty without a blocking reader per session.
 * <p>
 * Each subscription issues single-key {@code XREADGROUP} commands, so both the SDK's v1 standalone layout and v2
 * Redis Cluster hash-tag layout remain unchanged. Lettuce multiplexes the short reads over shared native connections;
 * listener work is handed to virtual threads and never blocks a Netty event loop.
 */
@Slf4j
@Component
public class ReactiveSessionStreamReceiver {

    private static final long ERROR_LOG_INTERVAL_NANOS = Duration.ofSeconds(30).toNanos();

    private final SessionStreamMetrics metrics;
    private final ReactiveReadOperations readOperations;
    private final ExecutorService ownedDispatchExecutor;
    private final Scheduler dispatchScheduler;
    private final Duration minimumPollDelay;
    private final Duration maximumIdlePollDelay;
    private final Duration errorRetryDelay;
    private final int readBatchSize;
    private final int maxInFlightReads;
    private final AtomicInteger inFlightReads = new AtomicInteger();

    private final Map<String, Registration> registrations = new ConcurrentHashMap<>();
    private volatile boolean shuttingDown;

    @Autowired
    public ReactiveSessionStreamReceiver(
            SessionStreamMetrics metrics,
            @Qualifier("sessionStreamReactiveRedisTemplate") ReactiveRedisTemplate<String, String> redisTemplate,
            @Value("${byclaw.session-stream.reactive-poll-min-delay-millis:5}") long minimumPollDelayMillis,
            @Value("${byclaw.session-stream.reactive-poll-max-idle-delay-millis:250}") long maximumIdlePollDelayMillis,
            @Value("${byclaw.session-stream.reactive-poll-error-delay-millis:1000}") long errorRetryDelayMillis,
            @Value("${byclaw.session-stream.read-batch-size:100}") int readBatchSize,
            @Value("${byclaw.session-stream.reactive-max-in-flight-reads:256}") int maxInFlightReads) {
        this(metrics,
            (consumer, options, offset) -> redisTemplate.<String, String>opsForStream().read(consumer, options, offset),
            Executors.newVirtualThreadPerTaskExecutor(), Duration.ofMillis(minimumPollDelayMillis),
            Duration.ofMillis(maximumIdlePollDelayMillis), Duration.ofMillis(errorRetryDelayMillis), readBatchSize,
            maxInFlightReads);
    }

    ReactiveSessionStreamReceiver(SessionStreamMetrics metrics, ReactiveReadOperations readOperations,
            Executor dispatchExecutor, Duration minimumPollDelay, Duration maximumIdlePollDelay,
            Duration errorRetryDelay, int readBatchSize, int maxInFlightReads) {
        this.metrics = metrics;
        this.readOperations = readOperations;
        this.ownedDispatchExecutor = dispatchExecutor instanceof ExecutorService service ? service : null;
        this.dispatchScheduler = Schedulers.fromExecutor(dispatchExecutor);
        this.minimumPollDelay = requirePositive(minimumPollDelay, "minimum poll delay");
        this.maximumIdlePollDelay = requireAtLeast(maximumIdlePollDelay, minimumPollDelay,
            "maximum idle poll delay");
        this.errorRetryDelay = requirePositive(errorRetryDelay, "error retry delay");
        if (readBatchSize < 1) throw new IllegalArgumentException("Session Stream read batch size must be positive");
        if (maxInFlightReads < 1) {
            throw new IllegalArgumentException("Session Stream max in-flight reads must be positive");
        }
        this.readBatchSize = readBatchSize;
        this.maxInFlightReads = maxInFlightReads;
    }

    public synchronized void register(String sessionId, String streamKey, String consumerName,
            RedisStreamMessageListener listener, boolean paused) {
        if (shuttingDown) throw new IllegalStateException("Reactive Session Stream receiver is shutting down");
        Registration registration = new Registration(sessionId, streamKey, consumerName, listener, paused);
        Registration existing = registrations.putIfAbsent(sessionId, registration);
        if (existing != null) return;
        if (!paused) registration.start();
    }

    public synchronized boolean resume(String sessionId) {
        Registration registration = registrations.get(sessionId);
        if (registration == null) return false;
        if (registration.paused.compareAndSet(true, false)) registration.start();
        return true;
    }

    public synchronized void unregister(String sessionId) {
        Registration registration = registrations.remove(sessionId);
        if (registration != null) registration.stop();
    }

    public int registeredSessionCount() {
        return registrations.size();
    }

    public boolean isPaused(String sessionId) {
        Registration registration = registrations.get(sessionId);
        return registration != null && registration.paused.get();
    }

    private Mono<Void> pollOnce(Registration registration) {
        return Mono.defer(() -> {
            if (registration.paused.get() || registrations.get(registration.sessionId) != registration) {
                return delay(maximumIdlePollDelay);
            }
            if (!tryAcquireRead()) return delay(registration.nextDelay(false));
            StreamReadOptions options = StreamReadOptions.empty().count(readBatchSize);
            Consumer consumer = Consumer.from(SessionStreamManager.CONSUMER_GROUP, registration.consumerName);
            StreamOffset<String> offset = StreamOffset.create(registration.streamKey, ReadOffset.lastConsumed());
            AtomicBoolean released = new AtomicBoolean();
            return Mono.defer(() -> readOperations.read(consumer, options, offset).collectList())
                .doFinally(ignored -> releaseRead(released))
                .flatMap(records -> Flux.fromIterable(records)
                    .concatMap(record -> dispatch(registration, record), 1)
                    .then(Mono.defer(() -> delay(registration.nextDelay(!records.isEmpty())))))
                .onErrorResume(error -> {
                    metrics.recordReadError(error);
                    if (registration.shouldLogError()) {
                        log.warn("Session Stream 异步读取异常，将重试, sessionId: {}, stream: {}, errorType: {}, "
                                + "errorMessage: {}",
                            registration.sessionId, registration.streamKey, error.getClass().getSimpleName(),
                            error.getMessage());
                    }
                    registration.resetDelay();
                    return delay(errorRetryDelay);
                });
        });
    }

    private Mono<Void> dispatch(Registration registration, MapRecord<String, String, String> record) {
        if (registration.paused.get() || registrations.get(registration.sessionId) != registration) {
            return Mono.empty();
        }
        return Mono.fromRunnable(() -> registration.listener.onMessage(record)).subscribeOn(dispatchScheduler).then();
    }

    private Mono<Void> delay(Duration duration) {
        return Mono.delay(duration).then();
    }

    private boolean tryAcquireRead() {
        while (true) {
            int current = inFlightReads.get();
            if (current >= maxInFlightReads) return false;
            if (inFlightReads.compareAndSet(current, current + 1)) return true;
        }
    }

    private void releaseRead(AtomicBoolean released) {
        if (released.compareAndSet(false, true)) inFlightReads.decrementAndGet();
    }

    @PreDestroy
    public synchronized void shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        registrations.values().forEach(Registration::stop);
        registrations.clear();
        dispatchScheduler.dispose();
        if (ownedDispatchExecutor != null) ownedDispatchExecutor.shutdownNow();
    }

    private Duration requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    private Duration requireAtLeast(Duration value, Duration minimum, String name) {
        requirePositive(value, name);
        if (value.compareTo(minimum) < 0) throw new IllegalArgumentException(name + " must not be below minimum");
        return value;
    }

    @FunctionalInterface
    interface ReactiveReadOperations {
        Flux<MapRecord<String, String, String>> read(Consumer consumer, StreamReadOptions options,
            StreamOffset<String> offset);
    }

    private final class Registration {
        private final String sessionId;
        private final String streamKey;
        private final String consumerName;
        private final RedisStreamMessageListener listener;
        private final AtomicBoolean paused;
        private final AtomicLong lastErrorLogNanos = new AtomicLong(Long.MIN_VALUE);
        private Duration currentDelay = minimumPollDelay;
        private Disposable loop;

        private Registration(String sessionId, String streamKey, String consumerName,
                RedisStreamMessageListener listener, boolean paused) {
            this.sessionId = sessionId;
            this.streamKey = streamKey;
            this.consumerName = consumerName;
            this.listener = listener;
            this.paused = new AtomicBoolean(paused);
        }

        private synchronized void start() {
            if (loop == null || loop.isDisposed()) {
                loop = Mono.defer(() -> pollOnce(this)).repeat().subscribe();
            }
        }

        private synchronized void stop() {
            if (loop != null) loop.dispose();
            loop = null;
        }

        private synchronized Duration nextDelay(boolean received) {
            if (received) {
                currentDelay = minimumPollDelay;
                return minimumPollDelay;
            }
            Duration next = currentDelay.multipliedBy(2);
            currentDelay = next.compareTo(maximumIdlePollDelay) > 0 ? maximumIdlePollDelay : next;
            return currentDelay;
        }

        private synchronized void resetDelay() {
            currentDelay = minimumPollDelay;
        }

        private boolean shouldLogError() {
            long now = System.nanoTime();
            long previous = lastErrorLogNanos.get();
            return (previous == Long.MIN_VALUE || now - previous >= ERROR_LOG_INTERVAL_NANOS)
                && lastErrorLogNanos.compareAndSet(previous, now);
        }
    }
}
