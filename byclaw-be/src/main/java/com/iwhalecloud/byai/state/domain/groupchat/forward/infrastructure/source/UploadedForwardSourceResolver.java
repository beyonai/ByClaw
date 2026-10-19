package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import java.util.Objects;
import org.springframework.stereotype.Component;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;

@Component
public class UploadedForwardSourceResolver implements ForwardSourceResolver {
    private final FilesService files; private final UserService users;
    private final ForwardSourceAuthorityReader authority; private final ForwardWorkspaceReader storage; private final ForwardUploadScope scopes;
    public UploadedForwardSourceResolver(FilesService files, UserService users, ForwardSourceAuthorityReader authority, ForwardWorkspaceReader storage, ForwardUploadScope scopes) {
        this.files=files; this.users=users; this.authority=authority; this.storage=storage; this.scopes=scopes;
    }
    @Override public ResolvedSource resolve(ForwardActor actor, SourceMessage source, SourceCandidate candidate) {
        var entry = association(actor, source, candidate);
        if (candidate.address().origin() == CandidateAddress.Origin.PUBLISHED_FILE) throw unresolved();
        return resolveFile(actor, source, candidate, files.findById(id(entry.get("fileId"))));
    }
    ResolvedSource resolveFile(ForwardActor actor, SourceMessage source, SourceCandidate candidate, Files file) {
        var entry = association(actor, source, candidate);
        if (file == null || file.getChatId() == null || file.getCreateBy() == null || file.getFileName() == null
            || "00X".equals(file.getFileStatus())) throw unresolved();
        var session = authority.requireUploadSession(actor, source.authority().backend(), file.getChatId());
        if (!session.actor().equals(actor) || session.enterpriseId() != actor.enterpriseId() || session.sessionId() != file.getChatId()
            || session.backend() != source.authority().backend()) throw unresolved();
        scopes.require(actor,file);
        var user = users.findById(file.getCreateBy());
        if (user == null || "X".equalsIgnoreCase(user.getState()) || user.getUserCode() == null || user.getUserCode().isBlank()) throw unresolved();
        String bucket = UserBucketNameResolver.buildUserBucketName(user.getUserCode());
        String path = uploadPath(file.getFileUrl(), bucket);
        String hint = text(entry.get("filePath"));
        if (hint == null && candidate.address().origin() == CandidateAddress.Origin.RESOURCE_REFERENCE) hint = text(entry.get("resourceId"));
        if (hint != null && !path.equals(workspacePath(hint))) throw unresolved();
        return new ResolvedSource(new SourceIdentity(actor.enterpriseId(), file.getCreateBy(), storage.storageType(file), bucket, path, null),
            file.getFileName(), Objects.requireNonNullElse(file.getContentType(), "application/octet-stream"), file.getLength(), "upload", source, candidate);
    }
    @Override public ForwardSourceRead open(ForwardActor actor, ResolvedSource resolved) {
        var user = users.findById(resolved.identity().ownerId());
        if (user == null || "X".equalsIgnoreCase(user.getState()) || user.getUserCode() == null || !UserBucketNameResolver.buildUserBucketName(user.getUserCode()).equals(resolved.identity().scopeId())) throw unresolved();
        return storage.open(resolved, user.getUserCode());
    }
}
