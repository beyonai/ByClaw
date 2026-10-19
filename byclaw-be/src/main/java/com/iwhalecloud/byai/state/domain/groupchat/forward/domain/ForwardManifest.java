package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import java.util.*;
/** Pure validation and current-manifest merging; owning stores supply locks and live lease checks. */
public final class ForwardManifest {
    private final ObjectMapper json;
    private final ForwardUploadReservation locations;
    private final long fileLimit;
    public ForwardManifest(ObjectMapper json,ForwardUploadReservation locations,long fileLimit) {
        this.json=json;
        this.locations=locations;
        this.fileLimit=fileLimit;
    }
    public SourceManifest complete(SourceManifest initial,FreezeCompletion completion,ForwardActor actor,Set<String> targets) {
        if(completion.resolutions().size()!=initial.candidates().size() || completion.proofs().size()>initial.candidates().size() || completion.resolutions().stream().map(CandidateResolution::candidateId).distinct().count()!=completion.resolutions().size() || completion.proofs().stream().map(SourceProof::sourceId).distinct().count()!=completion.proofs().size() || completion.proofs().stream().map(SourceProof::identity).distinct().count()!=completion.proofs().size()) throw invalid();
        for(var proof:completion.proofs()) {
            if(proof.sourceId()==null || proof.sourceId().isBlank() || proof.sourceId().length()>128 || proof.identity()==null || proof.identity().enterpriseId()!=actor.enterpriseId() || proof.size()<0 || proof.sha256()==null || !proof.sha256().matches("[a-f0-9]{64}"))throw invalid();
            for(var value:List.of(proof.identity().storageType(),proof.identity().scopeId(),proof.identity().path()))
            if(value.isBlank() || value.length()>4096 || value.chars().anyMatch(Character::isISOControl) || value.matches("(?i).*https?://.*") || value.contains("?") || value.contains("#"))throw invalid();
        }
        List<PreparedAttachment> attachments=new ArrayList<>();
        for(var candidate:initial.candidates()) {
            var result=completion.resolutions().stream().filter(r->r.candidateId().equals(candidate.candidateId())).findFirst().orElseThrow(ForwardManifest::invalid);
            if(result.sourceId()==null) {
                if(candidate.kind()!=SourceKind.UNRESOLVED_REFERENCE)throw invalid();
                continue;
            }
            if(completion.proofs().stream().noneMatch(p->p.sourceId().equals(result.sourceId())))throw invalid();
            for(var slot:initial.slots().stream().filter(s->s.candidateId().equals(candidate.candidateId())&&targets.contains(s.targetId())).toList()) {
                var existing=attachments.stream().filter(a->a.targetId().equals(slot.targetId())&&a.itemId().equals(slot.itemId())&&a.sourceId().equals(result.sourceId())).findFirst().orElse(null);
                List<String> refs=new ArrayList<>();
                if(candidate.address().origin()==CandidateAddress.Origin.RESOURCE_REFERENCE)refs.add(candidate.address().key());
                if(existing==null)attachments.add(new PreparedAttachment(slot.targetId(),slot.itemId(),slot.attachmentId(),result.sourceId(),List.of(candidate.candidateId()),refs));
                else {
                    var keys=new ArrayList<>(existing.candidateIds());
                    keys.add(candidate.candidateId());
                    var aliases=new ArrayList<>(existing.referenceKeys());
                    aliases.addAll(refs);
                    attachments.set(attachments.indexOf(existing),new PreparedAttachment(existing.targetId(),existing.itemId(),existing.attachmentId(),existing.sourceId(),keys,aliases));
                }
            }
        }
        if(completion.proofs().stream().anyMatch(p->completion.resolutions().stream().noneMatch(r->p.sourceId().equals(r.sourceId()))))throw invalid();
        var result=new SourceManifest(1,initial.candidates(),initial.slots(),completion.proofs(),completion.resolutions(),attachments);
        budgets(result);
        return result;
    }
    public void budgets(SourceManifest manifest) {
        long total=0;
        Map<String,Long> sizes=new HashMap<>();
        Map<String,Integer> counts=new HashMap<>();
        for(var attachment:manifest.attachments()) {
            var proof=proof(manifest,attachment.sourceId());
            if(proof.size()<0||proof.size()>Math.min(fileLimit,2147483648L))throw error("FORWARD_FILE_TOO_LARGE");
            long size=sizes.merge(attachment.targetId(),proof.size(),Long::sum);
            if(size>2147483648L)throw error("FORWARD_TARGET_TOO_LARGE");
            if(counts.merge(attachment.targetId(),1,Integer::sum)>100)throw error("FORWARD_TOO_MANY_ATTACHMENTS");
            total+=proof.size();
            if(total>10737418240L)throw error("FORWARD_REQUEST_TOO_LARGE");
        }
    }
    public ObjectNode patch(ObjectNode current,SourceManifest manifest,TargetLease lease,AttachmentCheckpointPatch patch) {
        if(lease.state()!=ForwardState.COPYING)throw error("FORWARD_LEASE_LOST");
        var object=patch.object();
        location(object,lease);
        var binding=manifest.attachments().stream().filter(a->a.targetId().equals(Long.toString(lease.targetId()))&&a.itemId().equals(object.itemId())&&a.attachmentId().equals(object.attachmentId())&&a.sourceId().equals(patch.sourceId())).findFirst().orElseThrow(ForwardManifest::invalid);
        var proof=proof(manifest,binding.sourceId());
        var result=current.deepCopy();
        var attempts=result.withArray("attempts");
        ObjectNode active=null;
        for(var entry:attempts)if(entry.path("object").path("itemId").asText().equals(object.itemId())&&entry.path("object").path("attachmentId").asText().equals(object.attachmentId())&&!"SUPERSEDED".equals(entry.path("state").asText())) {
            if(active!=null)throw invalid();
            active=(ObjectNode)entry;
        }
        if(patch.phase()==AttachmentCheckpointPatch.Phase.RESERVE) {
            if(object.sha256()!=null||object.size()!=0)throw invalid();
            for(var entry:attempts)if(entry.path("object").path("attemptId").asText().equals(object.attemptId())&&entry!=active)throw error("FORWARD_ATTEMPT_CONFLICT");
            if(active!=null) {
                var old=json.convertValue(active.get("object"),ForwardUploadedFile.class);
                if(old.attemptId().equals(object.attemptId())) {
                    if(!sameLocation(old,object)||!"RESERVED".equals(active.path("state").asText()))throw error("FORWARD_ATTEMPT_CONFLICT");
                    return result;
                }
                if("VERIFIED".equals(active.path("state").asText())||lease.owner().equals(active.path("reservationOwner").asText()))throw error("FORWARD_ATTEMPT_CONFLICT");
                active.put("state","SUPERSEDED");
            }
            ObjectNode reservation=json.valueToTree(new ForwardCopyAttempt(patch.sourceId(),object,ForwardCopyAttempt.State.RESERVED));
            reservation.put("reservationOwner",lease.owner());
            attempts.add(reservation);
        }
        else {
            if(active==null||!lease.owner().equals(active.path("reservationOwner").asText())||!"RESERVED".equals(active.path("state").asText())||!active.path("sourceId").asText().equals(patch.sourceId())||!sameLocation(json.convertValue(active.get("object"),ForwardUploadedFile.class),object)||object.size()!=proof.size()||!proof.sha256().equals(object.sha256())||object.uploadedFile().isEmpty())throw error("FORWARD_SOURCE_CHANGED");
            active.put("state","VERIFIED");
            active.set("object",json.valueToTree(object));
        }
        var copied=result.putArray("copiedObjects");
        var mapping=result.putObject("attachmentMapping");
        for(var entry:attempts)if("VERIFIED".equals(entry.path("state").asText())) {
            var o=json.convertValue(entry.get("object"),ForwardUploadedFile.class);
            copied.add(entry.get("object"));
            var b=manifest.attachments().stream().filter(a->a.targetId().equals(Long.toString(lease.targetId()))&&a.itemId().equals(o.itemId())&&a.attachmentId().equals(o.attachmentId())).findFirst().orElseThrow(ForwardManifest::invalid);
            for(var key:b.referenceKeys())mapping.put(json.valueToTree(List.of(b.itemId(),key)).toString(),b.attachmentId());
        }
        long count=manifest.attachments().stream().filter(a->a.targetId().equals(Long.toString(lease.targetId()))).count();
        result.put("progress",100*copied.size()/Math.max(1,count));
        return result;
    }
    public void ready(ObjectNode checkpoint,SourceManifest manifest,TargetLease lease) {
        budgets(manifest);
        for(var binding:manifest.attachments().stream().filter(a->a.targetId().equals(Long.toString(lease.targetId()))).toList()) {
            var proof=proof(manifest,binding.sourceId());
            int count=0;
            for(var entry:checkpoint.path("attempts"))if("VERIFIED".equals(entry.path("state").asText())&&binding.sourceId().equals(entry.path("sourceId").asText())&&binding.itemId().equals(entry.path("object").path("itemId").asText())&&binding.attachmentId().equals(entry.path("object").path("attachmentId").asText())) {
                count++;
                var object=json.convertValue(entry.get("object"),ForwardUploadedFile.class);
                location(object,lease);
                if(object.size()!=proof.size()||!proof.sha256().equals(object.sha256())||object.uploadedFile().isEmpty())throw error("FORWARD_SOURCE_CHANGED");
            }
            if(count!=1)throw error("FORWARD_ATTACHMENTS_INCOMPLETE");
        }
    }
    public static SourceProof proof(SourceManifest m,String id) {
        return m.proofs().stream().filter(p->p.sourceId().equals(id)).findFirst().orElseThrow(ForwardManifest::invalid);
    }
    private void location(ForwardUploadedFile object,TargetLease lease) {
        locations.validate(object);
        if(object.enterpriseId()!=lease.actor().enterpriseId()||object.targetSessionId()!=lease.targetSessionId()||object.forwardTargetId()!=lease.targetId())throw error("FORWARD_INVALID_UPLOAD");
    }
    private static boolean sameLocation(ForwardUploadedFile a,ForwardUploadedFile b) {
        return a.enterpriseId()==b.enterpriseId()&&a.targetSessionId()==b.targetSessionId()&&a.forwardTargetId()==b.forwardTargetId()&&a.itemId().equals(b.itemId())&&a.attachmentId().equals(b.attachmentId())&&a.attemptId().equals(b.attemptId())&&a.fileName().equals(b.fileName())&&a.createdAt().equals(b.createdAt());
    }
    private static IllegalArgumentException invalid() {
        return error("FORWARD_RESOURCE_UNRESOLVABLE");
    }
    private static IllegalArgumentException error(String code) {
        return new IllegalArgumentException(code);
    }
}
