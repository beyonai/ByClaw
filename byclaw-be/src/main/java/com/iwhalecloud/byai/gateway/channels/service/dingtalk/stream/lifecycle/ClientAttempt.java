package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

import com.dingtalk.open.app.api.OpenDingTalkClient;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

final class ClientAttempt {

    final OpenDingTalkClient client;
    final int attemptNumber;
    final AtomicBoolean sdkStopInvoked = new AtomicBoolean();
    final CompletableFuture<Void> attemptSettled = new CompletableFuture<>();
    volatile boolean startEntered;

    ClientAttempt(OpenDingTalkClient client, int attemptNumber) {
        this.client = client;
        this.attemptNumber = attemptNumber;
    }

    void stopOnce() throws Exception {
        if (sdkStopInvoked.compareAndSet(false, true)) {
            client.stop();
        }
    }

    void markSettled() {
        attemptSettled.complete(null);
    }

    boolean isSettled() {
        return attemptSettled.isDone();
    }
}
