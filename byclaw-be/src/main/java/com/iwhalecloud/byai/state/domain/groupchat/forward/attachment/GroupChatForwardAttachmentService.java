package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import org.springframework.stereotype.Service;
import java.io.*;
import java.security.*;
import java.util.*;

/** Callers must suspend transaction advice for streaming; checkpoint writers own only short transactions. */
@Service
public class GroupChatForwardAttachmentService {
    private final ForwardSourceResolver sources; private final GroupChatForwardFileUploader uploader;
    private final com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardStreamAdmission admission;
    private final ForwardUploadReservation locations; private final GroupChatForwardProperties properties;
    public GroupChatForwardAttachmentService(ForwardSourceResolver sources,GroupChatForwardFileUploader uploader,
            ForwardUploadReservation locations,GroupChatForwardProperties properties,com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardStreamAdmission admission) {
        this.sources=sources;this.uploader=uploader;this.locations=locations;this.properties=properties;this.admission=admission;
    }
    public SourceProof freezeProof(ForwardActor actor,ResolvedSource source) {
        try(var cancellation=new ForwardStreamCancellation()){return freezeProof(actor,source,cancellation);}
    }
    public SourceProof freezeProof(ForwardActor actor,ResolvedSource source,ForwardStreamCancellation cancellation) {
        if(source.identity().enterpriseId()!=actor.enterpriseId()) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        try(var permit=admission.acquire(cancellation);var read=cancellation.track(sources.open(actor,source))) {
            var input=new FingerprintStream(read.stream(),properties.effectiveMaxFileBytes());
            byte[] buffer=new byte[64*1024];while(input.read(buffer)!=-1) { permit.check(); }
            permit.verifyOwned();
            return new SourceProof(HexFormat.of().formatHex(digest().digest(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsBytes(source.identity()))),source.identity(),input.count,input.hash());
        } catch(IOException failure) {throw new UncheckedIOException("FORWARD_SOURCE_UNAVAILABLE",failure);}
    }
    public ForwardUploadedFile copy(ForwardTargetCopyHandle handle,ForwardItem item,SourceProof proof,ForwardUploadedFile allocated) {
        var lease=handle.current(); var prepared=handle.requireSource(item.itemId(),allocated.attachmentId(),proof.sourceId());
        if(!prepared.proof().equals(proof) || allocated.enterpriseId()!=lease.actor().enterpriseId()
            || allocated.targetSessionId()!=lease.targetSessionId() || allocated.forwardTargetId()!=lease.targetId()
            || !allocated.itemId().equals(item.itemId()) || !allocated.fileName().equals(prepared.resolved().fileName())
            || allocated.sha256()!=null || allocated.size()!=0) throw new IllegalArgumentException("FORWARD_INVALID_UPLOAD");
        locations.validate(allocated);
        return handle.copyOnce(allocated, () -> copyAttempt(handle, item, proof, allocated, prepared));
    }
    private ForwardUploadedFile copyAttempt(ForwardTargetCopyHandle handle, ForwardItem item, SourceProof proof,
            ForwardUploadedFile allocated, PreparedForwardSource prepared) {
        var lease = handle.current();
        handle.budget().reserve(lease.requestId(),lease.targetId(),item.itemId(),allocated.attachmentId(),proof.size());
        try(var slot=handle.budget().enter();var permit=admission.acquire(handle.cancellation())) {
            handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE,proof.sourceId(),allocated));
            ForwardUploadedFile copied;
            // Reservation is durable before the destination can exist. Reauthorization is part of open().
            try(var read=handle.cancellation().track(sources.open(lease.actor(),prepared.resolved()))) {
                var input=new FingerprintStream(read.stream(),properties.effectiveMaxFileBytes());
                copied=uploader.upload(lease.actor(),prepared.resolved().source().authority().backend(),
                    "knowledge".equals(prepared.resolved().adapterId()),allocated,input,proof,prepared.resolved().mediaType(),properties.effectiveMaxFileBytes());
                permit.check();
                if(input.count!=proof.size() || !proof.sha256().equals(input.hash())) throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");
            }
            if(!sameLocation(allocated,copied) || copied.size()!=proof.size() || !proof.sha256().equals(copied.sha256())) throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");
            permit.verifyOwned();
            handle.checkpoint(new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.VERIFY,proof.sourceId(),copied));
            return copied;
        } catch(RuntimeException failure) {throw failure;}
        catch(Exception failure) {throw new IllegalStateException("FORWARD_COPY_FAILED",failure);}
    }
    private static boolean sameLocation(ForwardUploadedFile a,ForwardUploadedFile b) {
        return b!=null && a.enterpriseId()==b.enterpriseId() && a.targetSessionId()==b.targetSessionId() && a.forwardTargetId()==b.forwardTargetId()
            && a.itemId().equals(b.itemId()) && a.attachmentId().equals(b.attachmentId()) && a.attemptId().equals(b.attemptId())
            && a.fileName().equals(b.fileName()) && a.createdAt().equals(b.createdAt());
    }
    private static MessageDigest digest() {
        try {return MessageDigest.getInstance("SHA-256");} catch(NoSuchAlgorithmException impossible) {throw new IllegalStateException(impossible);}
    }
    /** Enforces actual byte limits even when a source reports an absent or false Content-Length. */
    private static final class FingerprintStream extends InputStream {
        private final InputStream delegate;private final long maximum;private final MessageDigest digest=digest();private long count;
        FingerprintStream(InputStream delegate,long maximum) {this.delegate=delegate;this.maximum=maximum;}
        @Override public int read() throws IOException {byte[] one=new byte[1];return read(one,0,1)==-1?-1:one[0]&255;}
        @Override public int read(byte[] bytes,int offset,int length) throws IOException {
            if(length==0) return 0;
            int read=delegate.read(bytes,offset,(int)Math.min(length,maximum-count+1));
            if(read>0) {count+=read;if(count>maximum) throw new IllegalArgumentException("FORWARD_FILE_TOO_LARGE");digest.update(bytes,offset,read);}
            return read;
        }
        String hash() {return HexFormat.of().formatHex(digest.digest());}
    }
}
