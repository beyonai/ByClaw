package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

final class LeaseAcquireAttempt {

    final String candidateOwnerToken;
    final AtomicBoolean releaseInvoked = new AtomicBoolean();
    final CompletableFuture<Void> settled = new CompletableFuture<>();

    LeaseAcquireAttempt(String candidateOwnerToken) {
        this.candidateOwnerToken = candidateOwnerToken;
    }

    void markSettled() {
        settled.complete(null);
    }

    boolean isSettled() {
        return settled.isDone();
    }
}
