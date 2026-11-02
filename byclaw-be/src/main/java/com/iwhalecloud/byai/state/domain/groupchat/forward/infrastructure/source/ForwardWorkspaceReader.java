package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.impl.WhaleAgentStorageService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import org.springframework.stereotype.Component;

/** Source resolution proves the original owner; bytes use the ordinary shared-file download path. */
@Component
public class ForwardWorkspaceReader {
    private final ObjectStorageConfiguration configuration;
    private final FilesApplicationService files;
    public ForwardWorkspaceReader(ObjectStorageConfiguration configuration,FilesApplicationService files) {
        this.configuration=configuration;this.files=files;
    }
    public String storageType(Files file) {
        String type=file.getFileSystemType();
        return type==null||type.isBlank()?configuration.getStorageConfig().getStorageType():type;
    }
    public ForwardSourceRead open(ResolvedSource source,String ownerCode) {
        var identity=source.identity();
        if(!UserBucketNameResolver.buildUserBucketName(ownerCode).equals(identity.scopeId()))throw ForwardSourceFacts.unresolved();
        String path=identity.path().startsWith("/by/")?identity.path().substring(3):identity.path();
        var input=files.openCommonFileInputStream(identity.scopeId(),path,WhaleAgentStorageService.SHARE_TYPE_PUBLIC);
        var metadata=new FileMetadata();metadata.setFileName(source.fileName());metadata.setFileSize(source.size());metadata.setContentType(source.mediaType());
        return new ForwardSourceRead(input,metadata);
    }
}
