package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class GroupChatForwardCopyOrchestrationTest {
    @Test
    void renewalFailureCompletesQueuedFuturesEvenWhenRunningCopiesFinishSuccessfully() throws Exception {
        var store = mock(LegacyGroupChatForwardStore.class);
        var contexts = mock(GroupChatForwardExecutionContextService.class);
        var resolver = mock(ForwardSourceResolver.class);
        var attachments = mock(GroupChatForwardAttachmentService.class);
        var properties = new GroupChatForwardProperties();
        var actor = new ForwardActor(30, 1);
        var locator = new ForwardOperationLocator(1, 100, ForwardBackend.LEGACY);
        var lease = new TargetLease(100, 200, actor, 10, 20, "copy-owner", 1,
            Instant.now().plusSeconds(60), ForwardState.COPYING);
        var authority = new SourceAuthority(actor, ForwardBackend.LEGACY, 10, 50, null, null, "GROUP_CHAT", "CHAT", List.of());
        var message = new SourceMessage(50, 0, "files", null, Instant.now().toString(), List.of(),
            Map.of(), Map.of(), List.of(), authority);
        List<PreparedCandidate> candidates = new ArrayList<>();
        List<SourceProof> proofs = new ArrayList<>();
        List<PreparedAttachment> bindings = new ArrayList<>();
        List<ForwardItem> items = new ArrayList<>();
        for (int index = 0; index < 3; index++) {
            String id = Integer.toString(index);
            var address = new CandidateAddress(null, CandidateAddress.Origin.RELATED_FILE, id);
            candidates.add(new PreparedCandidate("candidate" + id, id, 50, SourceKind.UPLOADED_FILE, address));
            proofs.add(new SourceProof("proof" + id, new SourceIdentity(1, 30L, "minio", "scope", id, null),
                3, "a".repeat(64)));
            bindings.add(new PreparedAttachment("200", "item" + id, "attachment" + id, "proof" + id,
                List.of("candidate" + id), List.of()));
            items.add(new ForwardItem("item" + id, 50, false, 50, index, "files", null,
                Instant.now().toString(), List.of(), List.of()));
        }
        var manifest = new SourceManifest(1, candidates, List.of(), proofs, List.of(), bindings);
        var target = new TargetWork(200, 20, ForwardState.COPYING, JsonNodeFactory.instance.objectNode(), items);
        when(contexts.store(locator)).thenReturn(store);
        when(store.targetWork(any())).thenReturn(new ForwardWork(locator, actor, 10, null, manifest, true, target));
        when(store.source(any(TargetLease.class), eq(50L))).thenReturn(message);
        when(resolver.resolve(eq(actor), eq(message), any())).thenAnswer(call -> {
            SourceCandidate candidate = call.getArgument(2);
            var proof = proofs.get(Integer.parseInt(candidate.itemKey()));
            return new ResolvedSource(proof.identity(), "file.txt", "text/plain", 3L, "upload", message, candidate);
        });
        when(store.checkpointAttachment(any(), anyLong(), any())).thenAnswer(call -> {
            TargetLease current = call.getArgument(0);
            return new TargetLease(current.requestId(), current.targetId(), current.actor(), current.sourceSessionId(),
                current.targetSessionId(), current.owner(), current.fencingVersion() + 1, current.leaseUntil(), current.state());
        });
        var verified = new CountDownLatch(2);
        var renewalFailed = new CountDownLatch(1);
        var interrupted = new CountDownLatch(2);
        var releaseRunning = new CountDownLatch(1);
        var runningReturned = new CountDownLatch(2);
        var copyCalls = new AtomicInteger();
        var renewalFailure = new IllegalStateException("FORWARD_LEASE_LOST");
        when(store.renewTarget(any(), any())).thenAnswer(call -> {
            if (verified.getCount() == 0) {
                renewalFailed.countDown();
                throw renewalFailure;
            }
            return call.getArgument(0);
        });
        when(attachments.copy(any(), any(), any(), any())).thenAnswer(call -> {
            copyCalls.incrementAndGet();
            ForwardTargetCopyHandle handle = call.getArgument(0);
            SourceProof proof = call.getArgument(2);
            ForwardUploadedFile allocated = call.getArgument(3);
            handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE, proof.sourceId(), allocated));
            handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.VERIFY, proof.sourceId(), allocated));
            verified.countDown();
            // Keep both slots occupied until shutdown removes the third job. Stream closing belongs to Task11.
            boolean released = false;
            while (!released) {
                try {
                    released = releaseRunning.await(5, TimeUnit.SECONDS);
                    if (!released) throw new AssertionError("running copy was not released");
                } catch (InterruptedException ignored) {
                    interrupted.countDown();
                }
            }
            runningReturned.countDown();
            return allocated;
        });
        var coordinator = new GroupChatForwardService(store, null, contexts, null, resolver, null,
            attachments, new ForwardUploadReservation(properties), properties);
        var caller = Executors.newSingleThreadExecutor();
        Future<TargetLease> result = caller.submit(() -> coordinator.copyTarget(locator, lease, Duration.ofMillis(150)));
        try {
            assertThat(verified.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(renewalFailed.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(interrupted.await(3, TimeUnit.SECONDS)).isTrue();
            releaseRunning.countDown();
            assertThat(runningReturned.await(3, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> result.get(2, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class).hasRootCause(renewalFailure);
            assertThat(copyCalls.get()).isEqualTo(2);
            verify(store, never()).markReady(any());
        } finally {
            releaseRunning.countDown();
            result.cancel(true);
            caller.shutdownNow();
            assertThat(caller.awaitTermination(3, TimeUnit.SECONDS)).isTrue();
        }
    }
}
