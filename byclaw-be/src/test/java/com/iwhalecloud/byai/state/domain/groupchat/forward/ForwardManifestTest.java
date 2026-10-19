package com.iwhalecloud.byai.state.domain.groupchat.forward;
import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardManifest;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.time.Instant;
class ForwardManifestTest {
    ObjectMapper json=new ObjectMapper().findAndRegisterModules();GroupChatForwardProperties props=new GroupChatForwardProperties();ForwardUploadReservation locations=new ForwardUploadReservation(props);ForwardManifest service=new ForwardManifest(json,locations,props.effectiveMaxFileBytes());
    ForwardActor actor=new ForwardActor(30,1);SourceProof proof=new SourceProof("source",new SourceIdentity(1,30L,"minio","owner","file",null),3,"a".repeat(64));
    TargetLease lease=new TargetLease(100,200,actor,10,20,"claim",9007199254741001L,Instant.now().plusSeconds(60),ForwardState.COPYING);
    SourceManifest initial(){return new SourceManifest(1,List.of(new PreparedCandidate("c0","opaque",50,SourceKind.UPLOADED_FILE,new CandidateAddress(null,CandidateAddress.Origin.RELATED_FILE,"0"))),List.of(new PreparedSlot("c0","200","300","a1")),List.of(),List.of(),List.of());}
    SourceManifest frozen(){return service.complete(initial(),new FreezeCompletion(List.of(proof),List.of(new CandidateResolution("c0","source"))),actor,Set.of("200"));}
    @Test void preservesUnknownMaintenanceWhileVerifyingOneExactReservation()throws Exception{
        var object=locations.allocate(1,20,200,"300","a1","file");var current=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree("{\"maintenance\":{\"schemaVersion\":1,\"future\":[\"keep\"]}}");var reserved=service.patch(current,frozen(),lease,new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE,"source",object));assertThatThrownBy(()->service.ready(reserved,frozen(),lease)).hasMessage("FORWARD_ATTACHMENTS_INCOMPLETE");var complete=new ForwardUploadedFile(object.enterpriseId(), object.targetSessionId(), object.forwardTargetId(), object.itemId(), object.attachmentId(), object.attemptId(), object.fileName(), "text/plain", 3, proof.sha256(), object.createdAt(), Map.of("fileId","700","fileName","file","filePath","/.sessions/20/forwards/copy/file"));var verified=service.patch(reserved,frozen(),lease,new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.VERIFY,"source",complete));assertThat(verified.get("maintenance")).isEqualTo(current.get("maintenance"));assertThatCode(()->service.ready(verified,frozen(),lease)).doesNotThrowAnyException();assertThat(verified.path("progress").asInt()).isEqualTo(100);
    }
    @Test void sameClaimCannotReplaceItsInflightAttempt(){var object=locations.allocate(1,20,200,"300","a1","file");var reserved=service.patch(json.createObjectNode(),frozen(),lease,new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE,"source",object));var replacement=locations.allocate(1,20,200,"300","a1","file");assertThatThrownBy(()->service.patch(reserved,frozen(),lease,new AttachmentCheckpointPatch(AttachmentCheckpointPatch.Phase.RESERVE,"source",replacement))).hasMessage("FORWARD_ATTEMPT_CONFLICT");}
    @Test void unknownAssociationAndRequiredFileDowngradeAreRejected(){assertThatThrownBy(()->service.complete(initial(),new FreezeCompletion(List.of(),List.of(new CandidateResolution("c0",null))),actor,Set.of("200"))).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");assertThatThrownBy(()->service.complete(initial(),new FreezeCompletion(List.of(proof),List.of(new CandidateResolution("unknown","source"))),actor,Set.of("200"))).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");}
}
