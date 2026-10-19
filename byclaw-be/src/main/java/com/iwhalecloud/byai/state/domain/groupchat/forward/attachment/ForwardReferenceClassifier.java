package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import org.springframework.stereotype.Component;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;

/** Untyped references cannot silently hide a required file; typed folders never reach this reader. */
@Component
public class ForwardReferenceClassifier {
    public enum Disposition { FILE, DIRECTORY_NAME_ONLY, NON_FILE_NAME_ONLY }
    public record Classification(Disposition disposition,ResolvedSource file) { }
    private final KnowledgeForwardSourceResolver knowledge; private final WorkspaceForwardSourceResolver workspace;
    public ForwardReferenceClassifier(KnowledgeForwardSourceResolver knowledge,WorkspaceForwardSourceResolver workspace) {this.knowledge=knowledge;this.workspace=workspace;}
    public Classification classify(ForwardActor actor,SourceMessage source,SourceCandidate candidate) {
        var raw=association(actor,source,candidate);var hint=safeEntry(raw);
        if(hint.containsKey("datasetId") || hint.containsKey("directoryPath")) {
            var metadata=knowledge.metadata(actor,source,candidate);
            if("directory".equalsIgnoreCase(metadata.type())) return new Classification(Disposition.DIRECTORY_NAME_ONLY,null);
            return new Classification(Disposition.FILE,knowledge.resolve(actor,source,candidate));
        }
        String resource=text(raw.get("resourceId"));String key=candidate.address().key();
        if(resource!=null && (resource.startsWith("/") || hint.containsKey("filePath"))) return new Classification(Disposition.FILE,workspace.resolve(actor,source,candidate));
        if(key.startsWith("KG_DOC_FILE_") || key.startsWith("COMMON_FILE_") || key.startsWith("KG_DOC_FOLDER_") || key.startsWith("COMMON_FOLDER_")
            || hint.containsKey("fileId") || hint.containsKey("cloudResourceId")) throw unresolved();
        return new Classification(Disposition.NON_FILE_NAME_ONLY,null);
    }
}
