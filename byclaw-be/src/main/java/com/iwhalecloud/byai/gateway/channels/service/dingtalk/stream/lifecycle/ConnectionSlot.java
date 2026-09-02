package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

final class ConnectionSlot {

    final String robotCode;
    final Long resourceId;
    final long generation;
    final DingtalkRobotChannelConfig connectionConfig;
    final String desiredConfigFingerprint;
    final CompletableFuture<Void> generationDrained = new CompletableFuture<>();
    final CompletableFuture<Void> messagesDrained = new CompletableFuture<>();

    ConnectionState state = ConnectionState.LEASE_WAIT;
    ClientAttempt currentAttempt;
    LeaseAcquireAttempt currentLeaseAttempt;
    Future<?> retryFuture;
    boolean cancelled;
    boolean acceptingMessages;
    int inFlightMessages;
    String leaseOwnerToken;
    long leaseValidUntilNanos;
    String lastHandledForceNonce;

    ConnectionSlot(
            String robotCode,
            Long resourceId,
            long generation,
            DingtalkRobotChannelConfig connectionConfig,
            String desiredConfigFingerprint) {
        this.robotCode = robotCode;
        this.resourceId = resourceId;
        this.generation = generation;
        this.connectionConfig = connectionConfig;
        this.desiredConfigFingerprint = desiredConfigFingerprint;
    }

    synchronized void openMessageAdmission() {
        if (!cancelled) {
            acceptingMessages = true;
        }
    }

    synchronized MessageLease tryAcquireMessageLease(boolean registryShutdown, boolean leaseValid) {
        if (registryShutdown || !leaseValid || !acceptingMessages) {
            throw new IllegalStateException("DingTalk Stream message admission is closed");
        }
        inFlightMessages++;
        return new MessageLease(this);
    }

    synchronized void closeMessageAdmissionPermanently() {
        acceptingMessages = false;
        completeMessagesDrainedIfPossible();
    }

    synchronized void cancel() {
        cancelled = true;
        closeMessageAdmissionPermanently();
        if (retryFuture != null) {
            retryFuture.cancel(false);
        }
        tryCompleteGenerationDrained();
    }

    synchronized void setCurrentAttempt(ClientAttempt currentAttempt) {
        this.currentAttempt = currentAttempt;
    }

    synchronized void setCurrentLeaseAttempt(LeaseAcquireAttempt currentLeaseAttempt) {
        this.currentLeaseAttempt = currentLeaseAttempt;
    }

    synchronized void tryCompleteGenerationDrained() {
        boolean terminal = cancelled || state == ConnectionState.STOPPED;
        boolean clientSettled = currentAttempt == null || currentAttempt.isSettled();
        boolean leaseSettled = currentLeaseAttempt == null || currentLeaseAttempt.isSettled();
        boolean retrySettled = retryFuture == null || retryFuture.isDone() || retryFuture.isCancelled();
        if (terminal && clientSettled && leaseSettled && retrySettled) {
            generationDrained.complete(null);
        }
    }

    CompletableFuture<Void> generationDrained() {
        return generationDrained;
    }

    CompletableFuture<Void> messagesDrained() {
        return messagesDrained;
    }

    private synchronized void releaseMessageLease() {
        if (inFlightMessages <= 0) {
            return;
        }
        inFlightMessages--;
        completeMessagesDrainedIfPossible();
    }

    private void completeMessagesDrainedIfPossible() {
        if (!acceptingMessages && inFlightMessages == 0) {
            messagesDrained.complete(null);
        }
    }

    static final class MessageLease implements AutoCloseable {
        private final ConnectionSlot slot;
        private final AtomicBoolean closed = new AtomicBoolean();

        private MessageLease(ConnectionSlot slot) {
            this.slot = slot;
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                slot.releaseMessageLease();
            }
        }
    }
}
