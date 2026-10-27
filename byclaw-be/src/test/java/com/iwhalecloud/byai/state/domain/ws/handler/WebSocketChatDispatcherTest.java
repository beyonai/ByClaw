package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.assertj.core.api.Assertions.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.Test;

class WebSocketChatDispatcherTest {
    @Test
    void limitsOutstandingWorkAndPreservesConnectionOrder() throws Exception {
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(3, 2);
        EmbeddedChannel first = new EmbeddedChannel(), second = new EmbeddedChannel(), third = new EmbeddedChannel();
        CountDownLatch entered = new CountDownLatch(2), release = new CountDownLatch(1), done = new CountDownLatch(1);
        List<Integer> calls = new CopyOnWriteArrayList<>();
        try {
            dispatcher.submit(first, () -> { entered.countDown(); await(release); calls.add(1); });
            dispatcher.submit(first, () -> { calls.add(2); done.countDown(); });
            assertThatThrownBy(() -> dispatcher.submit(first, () -> calls.add(99)))
                .isInstanceOf(RejectedExecutionException.class);
            dispatcher.submit(second, () -> { entered.countDown(); await(release); });
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> dispatcher.submit(third, () -> calls.add(99)))
                .isInstanceOf(RejectedExecutionException.class);
            assertThat(calls).isEmpty();
            release.countDown();
            assertThat(done.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(calls).containsExactly(1, 2);
        }
        finally { release.countDown(); dispatcher.shutdown(); first.finishAndReleaseAll(); second.finishAndReleaseAll(); third.finishAndReleaseAll(); }
    }

    @Test
    void closedConnectionDiscardsQueuedWorkAndReleasesCapacityAfterActiveExit() throws Exception {
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(2, 2);
        EmbeddedChannel channel = new EmbeddedChannel(), other = new EmbeddedChannel();
        CountDownLatch entered = new CountDownLatch(1), interrupted = new CountDownLatch(1);
        AtomicBoolean queuedRan = new AtomicBoolean();
        try {
            dispatcher.submit(channel, () -> {
                entered.countDown();
                try { new CountDownLatch(1).await(); }
                catch (InterruptedException e) { interrupted.countDown(); Thread.currentThread().interrupt(); }
            });
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            dispatcher.submit(channel, () -> queuedRan.set(true));
            channel.close();
            dispatcher.closeChannel(channel);
            assertThat(interrupted.await(2, TimeUnit.SECONDS)).isTrue();
            CountDownLatch finished = new CountDownLatch(1);
            org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(2)).untilAsserted(() ->
                assertThatCode(() -> dispatcher.submit(other, finished::countDown)).doesNotThrowAnyException());
            assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(queuedRan).isFalse();
        }
        finally { dispatcher.shutdown(); channel.finishAndReleaseAll(); other.finishAndReleaseAll(); }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void failedActionDoesNotStrandTheConnectionQueueOrAdmissionSlots(boolean fatal) throws Exception {
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(2, 2);
        EmbeddedChannel channel = new EmbeddedChannel();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), done = new CountDownLatch(1);
        try {
            dispatcher.submit(channel, () -> { entered.countDown(); await(release); if (fatal) throw new AssertionError("failed action"); throw new IllegalStateException("failed action"); });
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            dispatcher.submit(channel, done::countDown);
            release.countDown();
            assertThat(done.await(1, TimeUnit.SECONDS)).isTrue();
        }
        finally { release.countDown(); dispatcher.shutdown(); channel.finishAndReleaseAll(); }
    }

    @Test
    void closeRequestFencesAdmissionBeforeNettyMarksChannelInactive() throws Exception {
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(3, 3);
        EmbeddedChannel channel = new EmbeddedChannel();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        try {
            dispatcher.submit(channel, () -> { entered.countDown(); await(release); });
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            dispatcher.closeChannel(channel);
            assertThat(channel.isActive()).isTrue();
            assertThatThrownBy(() -> dispatcher.submit(channel, () -> { }))
                .isInstanceOf(RejectedExecutionException.class);
        }
        finally { release.countDown(); dispatcher.shutdown(); channel.finishAndReleaseAll(); }
    }

    @Test
    void stopCancelsMatchingQueuedWorkAcrossDevicesWithoutBlockingFutureTurnsOrOtherScopes() throws Exception {
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(12, 8);
        EmbeddedChannel first = new EmbeddedChannel(), second = new EmbeddedChannel();
        CountDownLatch entered = new CountDownLatch(2), release = new CountDownLatch(1), completed = new CountDownLatch(3);
        var target = new WebSocketChatDispatcher.ChatKey(1L, 10L, 42L);
        List<String> calls = new CopyOnWriteArrayList<>();
        Runnable block = () -> {
            entered.countDown();
            while (release.getCount() > 0) {
                try { release.await(); } catch (InterruptedException ignored) { }
            }
            com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation.check();
            calls.add("late-send");
        };
        try {
            dispatcher.submit(first, () -> target, block);
            dispatcher.submit(second, () -> target, block);
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            dispatcher.submit(first, () -> target, () -> calls.add("cancelled-first"));
            dispatcher.submit(second, () -> target, () -> calls.add("cancelled-second"));
            dispatcher.submit(first, () -> new WebSocketChatDispatcher.ChatKey(1L, 11L, 42L),
                () -> { calls.add("other-tenant"); completed.countDown(); });
            dispatcher.submit(first, () -> new WebSocketChatDispatcher.ChatKey(2L, 10L, 42L),
                () -> { calls.add("other-user"); completed.countDown(); });
            dispatcher.cancel(target);
            dispatcher.submit(first, () -> target, () -> { calls.add("fresh-turn"); completed.countDown(); });
            release.countDown();
            assertThat(completed.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(calls).containsExactly("other-tenant", "other-user", "fresh-turn");
        }
        finally { release.countDown(); dispatcher.shutdown(); first.finishAndReleaseAll(); second.finishAndReleaseAll(); }
    }

    @Test
    void newlyResolvedSessionCanBeStoppedEvenWhenIngressHadNoSessionId() throws Exception {
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(2, 2);
        EmbeddedChannel channel = new EmbeddedChannel();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), finished = new CountDownLatch(1);
        AtomicBoolean cancelled = new AtomicBoolean(), sent = new AtomicBoolean();
        try {
            dispatcher.submit(channel, () -> new WebSocketChatDispatcher.ChatKey(1L, 10L, null), () -> {
                try {
                    com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation.bindSession(42L);
                    entered.countDown();
                    while (release.getCount() > 0) {
                        try { release.await(); } catch (InterruptedException ignored) { }
                    }
                    cancelled.set(com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation.isCancelled());
                    com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation.check();
                    sent.set(true);
                }
                finally { finished.countDown(); }
            });
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            dispatcher.cancel(new WebSocketChatDispatcher.ChatKey(1L, 10L, 42L));
            release.countDown();
            assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(cancelled).isTrue();
            assertThat(sent).isFalse();
        }
        finally { release.countDown(); dispatcher.shutdown(); channel.finishAndReleaseAll(); }
    }

    private static void await(CountDownLatch latch) {
        try { if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("Timed out"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
