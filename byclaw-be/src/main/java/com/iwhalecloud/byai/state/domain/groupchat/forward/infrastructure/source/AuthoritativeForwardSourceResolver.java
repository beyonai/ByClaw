package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;

/** Reauthorizes the owning selected message before each stream, including repeated proof/copy reads. */
@Component @Primary
public class AuthoritativeForwardSourceResolver implements ForwardSourceResolver {
    private final ForwardSourceAuthorityReader authority; private final UploadedForwardSourceResolver uploads;
    private final WorkspaceForwardSourceResolver workspace; private final KnowledgeForwardSourceResolver knowledge;
    private final ForwardReferenceClassifier classifier;
    public AuthoritativeForwardSourceResolver(ForwardSourceAuthorityReader authority,UploadedForwardSourceResolver uploads,
            WorkspaceForwardSourceResolver workspace,KnowledgeForwardSourceResolver knowledge,ForwardReferenceClassifier classifier) {
        this.authority=authority;this.uploads=uploads;this.workspace=workspace;this.knowledge=knowledge;this.classifier=classifier;
    }
    @Override public ResolvedSource resolve(ForwardActor actor,SourceMessage source,SourceCandidate candidate) {
        var entry=association(actor,source,candidate);
        if(candidate.address().origin()==CandidateAddress.Origin.PUBLISHED_FILE) return knowledge.resolve(actor,source,candidate);
        return switch(candidate.kind()) {
            case KNOWLEDGE_FILE -> knowledge.resolve(actor,source,candidate);
            case USER_WORKSPACE_FILE -> workspace.resolve(actor,source,candidate);
            case UPLOADED_FILE -> uploads.resolve(actor,source,candidate);
            case UNRESOLVED_REFERENCE -> {
                var classification=classifier.classify(actor,source,candidate);
                if(classification.disposition()!=ForwardReferenceClassifier.Disposition.FILE) throw unresolved();
                yield classification.file();
            }
        };
    }
    @Override public ForwardSourceRead open(ForwardActor actor,ResolvedSource source) {
        var evidence=source.source().authority();
        if(evidence==null || !evidence.actor().equals(actor)) throw unresolved();
        var current=authority.readMessage(actor,evidence.backend(),evidence.sourceSessionId(),evidence.selectedMessageId());
        if(evidence.currentItemId()!=null && !evidence.currentItemId().equals(current.authority().currentItemId())) current=current.mergedItems().stream()
            .filter(item -> item.authority()!=null && evidence.currentItemId().equals(item.authority().currentItemId())).findFirst().orElseThrow(ForwardSourceFacts::unresolved);
        if (current.authority() == null || !actor.equals(current.authority().actor())
            || current.authority().backend() != evidence.backend()
            || current.authority().sourceSessionId() != evidence.sourceSessionId()
            || current.authority().selectedMessageId() != evidence.selectedMessageId()) throw unresolved();
        var verified=resolve(actor,current,source.candidate());
        if(!verified.identity().equals(source.identity())) throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");
        return switch(verified.adapterId()) {
            case "upload" -> uploads.open(actor,verified);
            case "knowledge" -> knowledge.open(actor,verified);
            default -> throw unresolved();
        };
    }
}
