package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class GroupChatForwardAttachmentServiceTest {
    static TargetLease lease(long fence) {
        return new TargetLease(1, 2, new ForwardActor(3, 4), 5, 6, "worker", fence,
            Instant.now().plusSeconds(60), ForwardState.COPYING);
    }
    static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage sourceMessage() {
        return new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage(
            31,0,"",new ForwardSpeaker(SpeakerType.USER,"21","sender"),"2026-10-16T00:00:00Z",
            List.of(),Map.of(),Map.of(),List.of(),new SourceAuthority(lease(1).actor(), ForwardBackend.LEGACY, 5, 31, null, null, null, null, List.of()));
    }
    static ForwardUploadedFile object(String attachment, String attempt) {
        return new ForwardUploadedFile(4, 6, 2, "7", attachment, attempt, "same.txt", null, 0, null, Instant.now());
    }
    @Test void concurrentCheckpointsAndRenewalsUseLatestAcknowledgedFence() throws Exception {
        List<Long> fences = Collections.synchronizedList(new ArrayList<>());
        AttachmentCheckpointWriter writer = new AttachmentCheckpointWriter() {
            public TargetLease checkpointAttachment(TargetLease current, long expected, AttachmentCheckpointPatch patch) {
                assertThat(expected).isEqualTo(current.fencingVersion());
                fences.add(expected);
                return lease(expected + 1);
            }
            public TargetLease renewTarget(TargetLease current, Duration duration) {
                return current;
            }
        };
        try (var handle = new DefaultForwardTargetCopyHandle(lease(10), writer, List.of(), new ForwardCopyBudget(new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties()));
             var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE, "source", object("a", "x"))));
            var second = executor.submit(() -> handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE, "other", object("b", "y"))));
            first.get(); second.get(); handle.renew(Duration.ofSeconds(30));
            assertThat(fences).containsExactly(10L, 11L);
            assertThat(handle.handoff().fencingVersion()).isEqualTo(12);
            assertThatThrownBy(() -> handle.renew(Duration.ofSeconds(30))).hasMessage("FORWARD_LEASE_LOST");
        }
    }
    @Test void unknownCheckpointOutcomeStopsHandleWithoutReload() {
        AttachmentCheckpointWriter writer = new AttachmentCheckpointWriter() {
            public TargetLease checkpointAttachment(TargetLease current, long expected, AttachmentCheckpointPatch patch) {
                throw new IllegalStateException("connection lost after send");
            }
            public TargetLease renewTarget(TargetLease current, Duration duration) { throw new AssertionError("must not renew"); }
        };
        var handle = new DefaultForwardTargetCopyHandle(lease(1), writer, List.of(), new ForwardCopyBudget(new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties()));
        assertThatThrownBy(() -> handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE, "s", object("a", "x"))))
            .hasMessage("connection lost after send");
        assertThatThrownBy(handle::handoff).hasMessage("FORWARD_LEASE_LOST");
        assertThatThrownBy(() -> handle.renew(Duration.ofSeconds(30))).hasMessage("FORWARD_LEASE_LOST");
    }
    @Test void ownerChangeCannotBeAdoptedFromWriter() {
        var writer = new AttachmentCheckpointWriter() {
            public TargetLease checkpointAttachment(TargetLease current, long expected, AttachmentCheckpointPatch patch) {
                var next = lease(expected + 1);
                return new TargetLease(next.requestId(), next.targetId(), next.actor(), next.sourceSessionId(), next.targetSessionId(), "other", next.fencingVersion(), next.leaseUntil(), next.state());
            }
            public TargetLease renewTarget(TargetLease current, Duration duration) { return current; }
        };
        var handle = new DefaultForwardTargetCopyHandle(lease(1), writer, List.of(), new ForwardCopyBudget(new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties()));
        assertThatThrownBy(() -> handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE, "s", object("a", "x"))))
            .hasMessage("FORWARD_LEASE_LOST");
    }
    @Test void changedSourceFailsFrozenDigestAndNeverCheckpointsVerified() throws Exception {
        var props = new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties();
        var resolver = org.mockito.Mockito.mock(ForwardSourceResolver.class);
        var store = org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.storage.GroupChatForwardFileUploader.class);
        var locations = new com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation(props);
        var service = new GroupChatForwardAttachmentService(resolver, store, locations, props, ForwardAdmissionFixture.admission());
        var identity = new SourceIdentity(4,22L,"minio","byclaw-owner","/by/file",null);
        var resolved = new ResolvedSource(identity,"same.txt","text/plain",4L,"upload",sourceMessage(),null);
        var metadata = new com.iwhalecloud.byai.common.storage.model.FileMetadata();
        org.mockito.Mockito.when(resolver.open(lease(1).actor(),resolved)).thenAnswer(invocation -> new ForwardSourceRead(new java.io.ByteArrayInputStream("good".getBytes()),metadata));
        var proof = service.freezeProof(lease(1).actor(),resolved);
        assertThat(proof.size()).isEqualTo(4);
        var item = new ForwardItem("7",31,false,31,0,"",new ForwardSpeaker(SpeakerType.USER,"21","sender"),"2026-10-16T00:00:00Z",List.of(),List.of());
        var binding = new PreparedForwardSource("7","a",proof,resolved,List.of("opaque"),List.of());
        List<AttachmentCheckpointPatch.Phase> phases = new ArrayList<>();
        AttachmentCheckpointWriter writer = new AttachmentCheckpointWriter() {
            public TargetLease checkpointAttachment(TargetLease current,long expected,AttachmentCheckpointPatch patch) { phases.add(patch.phase());return lease(expected+1); }
            public TargetLease renewTarget(TargetLease current,Duration duration) {return current;}
        };
        var closed = new java.util.concurrent.atomic.AtomicBoolean();
        org.mockito.Mockito.when(resolver.open(lease(1).actor(),resolved)).thenAnswer(invocation -> new ForwardSourceRead(new java.io.ByteArrayInputStream("evil".getBytes()) {
            @Override public void close() {closed.set(true);}
        },metadata));
        org.mockito.Mockito.when(store.upload(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyBoolean(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyLong())).thenAnswer(invocation -> {
            java.io.InputStream input=invocation.getArgument(4);input.transferTo(java.io.OutputStream.nullOutputStream()); return invocation.getArgument(3);
        });
        var allocated=locations.allocate(4,6,2,"7","a","same.txt");
        try(var handle=new DefaultForwardTargetCopyHandle(lease(1),writer,List.of(binding),new ForwardCopyBudget(props))) {
            assertThatThrownBy(() -> service.copy(handle,item,proof,allocated)).hasMessage("FORWARD_SOURCE_CHANGED");
        }
        assertThat(phases).containsExactly(AttachmentCheckpointPatch.Phase.RESERVE);
        assertThat(closed).isTrue();
    }
    @Test void aggregateLimitsUseLongAndRespectPlatformLimit() {
        var props = new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties();
        props.setPlatformMaxFileSize(org.springframework.util.unit.DataSize.ofMegabytes(100));
        assertThat(props.effectiveMaxFileBytes()).isEqualTo(104857600L);
        props.setPlatformMaxFileSize(org.springframework.util.unit.DataSize.ofGigabytes(4));
        assertThat(props.effectiveMaxFileBytes()).isEqualTo(2147483648L);
        var budget = new ForwardCopyBudget(props);
        for(int target=1;target<=5;target++) budget.reserve(1,target,"item","a",2147483648L);
        assertThatThrownBy(() -> budget.reserve(1,6,"item","a",1)).hasMessage("FORWARD_REQUEST_TOO_LARGE");
        assertThatThrownBy(() -> new ForwardCopyBudget(props).reserve(1,1,"item","a",2147483649L)).hasMessage("FORWARD_FILE_TOO_LARGE");
        var targetBudget = new ForwardCopyBudget(props);targetBudget.reserve(1,1,"item","a",2147483648L);
        assertThatThrownBy(() -> targetBudget.reserve(1,1,"item","b",1)).hasMessage("FORWARD_TARGET_TOO_LARGE");
    }

    @Test void sameItemAliasesShareOneCopyButDifferentItemsDoNot() throws Exception {
        var props=new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties();
        var resolver=org.mockito.Mockito.mock(ForwardSourceResolver.class);
        var uploader=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.storage.GroupChatForwardFileUploader.class);
        var locations=new com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation(props);
        var service=new GroupChatForwardAttachmentService(resolver,uploader,locations,props,ForwardAdmissionFixture.admission());
        var source=new ResolvedSource(new SourceIdentity(4,22L,"minio","byclaw-owner","/by/file",null),"same.txt","text/plain",4L,"upload",sourceMessage(),null);
        org.mockito.Mockito.when(resolver.open(lease(1).actor(),source)).thenAnswer(invocation -> new ForwardSourceRead(new java.io.ByteArrayInputStream("same".getBytes()),new com.iwhalecloud.byai.common.storage.model.FileMetadata()));
        var proof=service.freezeProof(lease(1).actor(),source);
        var first=new PreparedForwardSource("7","a",proof,source,List.of("first-alias","second-alias"),List.of());
        var other=new PreparedForwardSource("8","b",proof,source,List.of("first-alias"),List.of());
        List<AttachmentCheckpointPatch> patches=new ArrayList<>();
        var writer=new AttachmentCheckpointWriter() {
            public TargetLease checkpointAttachment(TargetLease lease,long expected,AttachmentCheckpointPatch patch) {patches.add(patch);return GroupChatForwardAttachmentServiceTest.lease(expected+1);}
            public TargetLease renewTarget(TargetLease lease,Duration duration) {return lease;}
        };
        org.mockito.Mockito.when(uploader.upload(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyBoolean(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyLong())).thenAnswer(invocation -> {
            java.io.InputStream input=invocation.getArgument(4);assertThat(input.readAllBytes()).isEqualTo("same".getBytes());
            ForwardUploadedFile a=invocation.getArgument(3);
            return new ForwardUploadedFile(a.enterpriseId(), a.targetSessionId(), a.forwardTargetId(), a.itemId(), a.attachmentId(), a.attemptId(), a.fileName(), "text/plain", 4, proof.sha256(), a.createdAt());
        });
        try(var handle=new DefaultForwardTargetCopyHandle(lease(1),writer,List.of(first,other),new ForwardCopyBudget(props))) {
            var item=new ForwardItem("7",31,false,31,0,"",new ForwardSpeaker(SpeakerType.USER,"21","sender"),"2026-10-16T00:00:00Z",List.of(),List.of());
            var second=new ForwardItem("8",32,false,32,1,"",item.speaker(),item.createdAt(),List.of(),List.of());
            var allocated=locations.allocate(4,6,2,"7","a","same.txt");
            var copy=service.copy(handle,item,proof,allocated);
            var alias=service.copy(handle,item,proof,allocated);
            var different=service.copy(handle,second,proof,locations.allocate(4,6,2,"8","b","same.txt"));
            assertThat(alias).isEqualTo(copy);assertThat(different.attemptId()).isNotEqualTo(copy.attemptId());
            assertThat(patches).hasSize(4);assertThat(handle.handoff().fencingVersion()).isEqualTo(5);
        }
    }

    @Test void staleAttemptCannotOverwriteNewAttempt() {
        var writer=org.mockito.Mockito.mock(AttachmentCheckpointWriter.class);
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        var handle=new DefaultForwardTargetCopyHandle(lease(1),writer,List.of(),new ForwardCopyBudget(new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties()));
        var current=object("a","new");var stale=object("a","old");
        assertThat(handle.copyOnce(current,() -> {calls.incrementAndGet();return current;})).isEqualTo(current);
        assertThatThrownBy(() -> handle.copyOnce(stale,() -> {calls.incrementAndGet();return stale;})).hasMessage("FORWARD_ATTEMPT_CONFLICT");
        assertThat(calls).hasValue(1);
    }
    @Test void sameNameFilesHaveDistinctAttempts() {
        var resolver=new com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation(new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties());
        assertThat(resolver.allocate(4,6,2,"7","a","same.txt").attemptId()).isNotEqualTo(resolver.allocate(4,6,2,"7","b","same.txt").attemptId());
    }
    @Test void freezeClosesSourceOnActualSizeLimitFailure() {
        var props=new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties();props.setMaxFileBytes(2);
        var source=new ResolvedSource(new SourceIdentity(4,22L,"minio","owner","/by/file",null),"name","text/plain",null,"upload",sourceMessage(),null);
        var resolver=org.mockito.Mockito.mock(ForwardSourceResolver.class);var closed=new java.util.concurrent.atomic.AtomicBoolean();
        org.mockito.Mockito.when(resolver.open(lease(1).actor(),source)).thenReturn(new ForwardSourceRead(new java.io.ByteArrayInputStream(new byte[]{1,2,3}) {
            @Override public void close() {closed.set(true);}
        },new com.iwhalecloud.byai.common.storage.model.FileMetadata()));
        var service=new GroupChatForwardAttachmentService(resolver,org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.storage.GroupChatForwardFileUploader.class),new com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation(props),props,ForwardAdmissionFixture.admission());
        assertThatThrownBy(() -> service.freezeProof(lease(1).actor(),source)).hasMessage("FORWARD_FILE_TOO_LARGE");assertThat(closed).isTrue();
    }

}
