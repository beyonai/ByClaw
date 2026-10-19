package com.iwhalecloud.byai.state.domain.groupchat.forward.port;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.AttachmentCheckpointWriter;
import java.time.Duration;
import java.util.Set;
/** Short owning-store transactions. Full manifests and arbitrary state transitions are never worker commands. */
public interface GroupChatForwardStore extends AttachmentCheckpointWriter {
    CommitResult commit(TargetLease lease);
    void failTarget(TargetLease lease,String code,boolean retryable);
    void failRequest(RequestLease lease,String code,boolean retryable);
    ForwardOperation completeText(ForwardActor actor,long sourceId,long requestId);
    ForwardOperation prepare(ForwardActor actor,long sourceId,ForwardInput input);
    WorkPage discoverWork(long enterpriseId,String afterTargetId,int limit);
    WorkPage discoverRequestWork(ForwardOperationLocator locator);
    TargetIdentity inspectTarget(ForwardOperationLocator locator,long targetId);
    OperationBinding inspect(ForwardOperationLocator locator);
    RequestLease claimRequest(ForwardOperationLocator locator,String owner,Duration duration);
    TargetLease claimTarget(ForwardOperationLocator locator,long targetId,String owner,Duration duration);
    RequestLease renewRequest(RequestLease lease,Duration duration);
    void freezeSources(RequestLease lease,FreezeCompletion completion);
    TargetLease markReady(TargetLease lease);
    ForwardWork requestWork(RequestLease lease);
    ForwardWork targetWork(TargetLease lease);
    SourceMessage source(RequestLease lease,long selectedMessageId);
    SourceMessage source(TargetLease lease,long selectedMessageId);
    ForwardOperation status(ForwardActor actor,long sourceId,long requestId);
    ForwardOperation retry(ForwardActor actor,long sourceId,long requestId,Set<Long> targetGroupIds);
}
