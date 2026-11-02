package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.Test;

class WebSocketPollDispatcherTest {
    @Test
    void activePollCoalescesTicksWithoutRetainingWorkAndNextTickCanRun() throws Exception {
        WebSocketPollDispatcher dispatcher = new WebSocketPollDispatcher(2);
        EmbeddedChannel channel = new EmbeddedChannel();
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), next = new CountDownLatch(1);
        AtomicInteger discarded = new AtomicInteger();
        try {
            assertThat(dispatcher.submit(channel, () -> block(started, release))).isTrue();
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            for (int i = 0; i < 100; i++) assertThat(dispatcher.submit(channel, discarded::incrementAndGet)).isFalse();
            release.countDown();
            assertThat(admitEventually(dispatcher, channel, next::countDown)).isTrue();
            assertThat(next.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(discarded).hasValue(0);
        }
        finally {
            release.countDown();
            dispatcher.shutdown();
            channel.finishAndReleaseAll();
        }
    }

    @Test
    void globalBudgetRejectsOtherChannelsWithoutCreatingQueuedPolls() throws Exception {
        WebSocketPollDispatcher dispatcher = new WebSocketPollDispatcher(1);
        EmbeddedChannel first = new EmbeddedChannel(), second = new EmbeddedChannel();
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), next = new CountDownLatch(1);
        try {
            assertThat(dispatcher.submit(first, () -> block(started, release))).isTrue();
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(dispatcher.submit(second, () -> { throw new AssertionError("Rejected poll must not run"); })).isFalse();
            release.countDown();
            assertThat(admitEventually(dispatcher, second, next::countDown)).isTrue();
            assertThat(next.await(2, TimeUnit.SECONDS)).isTrue();
        }
        finally {
            release.countDown();
            dispatcher.shutdown();
            first.finishAndReleaseAll();
            second.finishAndReleaseAll();
        }
    }

    @Test
    void closedChannelAndShutdownRejectPolls() {
        WebSocketPollDispatcher dispatcher = new WebSocketPollDispatcher(1);
        EmbeddedChannel channel = new EmbeddedChannel(), another = new EmbeddedChannel();
        try {
            dispatcher.closeChannel(channel);
            assertThat(dispatcher.submit(channel, () -> { })).isFalse();
            dispatcher.shutdown();
            assertThat(dispatcher.submit(another, () -> { })).isFalse();
        }
        finally {
            dispatcher.shutdown();
            channel.finishAndReleaseAll();
            another.finishAndReleaseAll();
        }
    }

    @Test
    void invalidGlobalBudgetFailsFast() {
        assertThatThrownBy(() -> new WebSocketPollDispatcher(0)).isInstanceOf(IllegalArgumentException.class);
    }

    private void block(CountDownLatch started, CountDownLatch release) {
        started.countDown();
        try {
            release.await();
        }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private boolean admitEventually(WebSocketPollDispatcher dispatcher, EmbeddedChannel channel, Runnable action) {
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        do {
            if (dispatcher.submit(channel, action)) return true;
            Thread.yield();
        } while (System.nanoTime() < until);
        return false;
    }
}
