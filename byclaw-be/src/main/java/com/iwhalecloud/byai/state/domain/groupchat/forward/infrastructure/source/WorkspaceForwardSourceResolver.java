package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import org.springframework.stereotype.Component;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;

/** A workspace reference does not imply an owner. Only an exact, associated upload row can supply one. */
@Component
public class WorkspaceForwardSourceResolver implements ForwardSourceResolver {
    private final FilesService files; private final UploadedForwardSourceResolver uploads;
    public WorkspaceForwardSourceResolver(FilesService files, UploadedForwardSourceResolver uploads) { this.files=files; this.uploads=uploads; }
    @Override public ResolvedSource resolve(ForwardActor actor, SourceMessage source, SourceCandidate candidate) {
        var entry = association(actor, source, candidate);
        String path = workspacePath(text(entry.get("filePath")) == null ? text(entry.get("resourceId")) : text(entry.get("filePath")));
        // Search only the source's authorized upload session, never arbitrary users or basename matches.
        var matches = files.findForwardSessionFiles(source.authority().sourceSessionId()).stream().filter(file -> {
            try {
                String recorded = file.getFileUrl();
                if (recorded != null && recorded.startsWith("/commonFile/preview?")) {
                    String raw = java.net.URI.create(recorded).getRawQuery();
                    var params = java.util.Arrays.stream(raw.split("&")).filter(v -> v.startsWith("filePath=")).toList();
                    return params.size() == 1 && path.equals(workspacePath(java.net.URLDecoder.decode(params.getFirst().substring(9), java.nio.charset.StandardCharsets.UTF_8)));
                }
                return path.equals(workspacePath(recorded));
            } catch (RuntimeException ignored) { return false; }
        }).toList();
        if (matches.size() != 1) throw unresolved();
        return uploads.resolveFile(actor, source, candidate, matches.getFirst());
    }
    @Override public ForwardSourceRead open(ForwardActor actor, ResolvedSource source) { return uploads.open(actor, source); }
}
