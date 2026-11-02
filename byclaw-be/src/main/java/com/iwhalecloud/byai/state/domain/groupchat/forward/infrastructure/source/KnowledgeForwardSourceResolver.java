package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import org.springframework.stereotype.Component;
import java.util.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;

/** Resource IDs identify real knowledge resources; a missing fileId on a published cloud file is normal. */
@Component
public class KnowledgeForwardSourceResolver implements ForwardSourceResolver {
    private final DatasetApplicationService datasets;
    public KnowledgeForwardSourceResolver(DatasetApplicationService datasets) { this.datasets=datasets; }
    public DatasetApplicationService.ForwardDatasetFile metadata(ForwardActor actor, SourceMessage source, SourceCandidate candidate) {
        var entry=association(actor,source,candidate);
        String path; long resource;
        if(candidate.address().origin()==CandidateAddress.Origin.PUBLISHED_FILE) {
            if(!"GROUP_CHAT".equals(source.authority().scene()) || !Set.of("TASK_RESULT","FORWARD_SINGLE","FORWARD_MERGED").contains(source.authority().kind())) throw unresolved();
            path=path(text(entry.get("filePath")));
            String requestedCloud=text(entry.get("cloudResourceId"));
            var matches=source.authority().publicationFiles().stream().filter(file -> {
                try { return path.equals(path(text(file.get("filePath")))) && (requestedCloud==null || requestedCloud.equals(text(file.get("cloudResourceId")))); }
                catch(RuntimeException error) { return false; }
            }).toList();
            if(matches.size()!=1) throw unresolved();
            resource=id(matches.getFirst().get("cloudResourceId"));
        } else {
            var hint=safeEntry(entry);
            resource=id(hint.get("datasetId"));
            String hintPath=text(hint.get("directoryPath"));
            path=path(hintPath == null ? null : hintPath.replaceAll("/+$", ""));
        }
        return datasets.forwardMetadata(actor,resource,path);
    }
    @Override public ResolvedSource resolve(ForwardActor actor,SourceMessage source,SourceCandidate candidate) {
        var file=metadata(actor,source,candidate);
        if(!"file".equalsIgnoreCase(file.type())) throw unresolved();
        return new ResolvedSource(new SourceIdentity(actor.enterpriseId(),null,"qa",Long.toString(file.resourceId()),file.path(),null),
            file.name(),"application/octet-stream",file.size(),"knowledge",source,candidate);
    }
    @Override public ForwardSourceRead open(ForwardActor actor,ResolvedSource source) {
        return datasets.forwardOpen(actor,datasets.forwardMetadata(actor,id(source.identity().scopeId()),source.identity().path()));
    }
}
