package com.iwhalecloud.byai.manager.domain.file.service;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import org.springframework.stereotype.Component;

/**
 * Resolves common uploaded file locations such as icons and feedback attachments.
 */
@Component
public class CommonFilePathResolver {

    public static final String NAMESPACE = "common-file";

    public StorageLocation icon(String path) {
        return StorageLocation.of(NAMESPACE, Constants.BUCKET_NAME_ICON, path);
    }

    public StorageLocation feedback(String path) {
        return StorageLocation.of(NAMESPACE, Constants.BUCKET_NAME_FEEDBACK, path);
    }

    public StorageLocation arbitrary(String bucketName, String path) {
        return StorageLocation.of(NAMESPACE, bucketName, path);
    }
}
