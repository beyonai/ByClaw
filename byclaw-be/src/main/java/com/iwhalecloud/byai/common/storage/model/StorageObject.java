package com.iwhalecloud.byai.common.storage.model;

import lombok.Builder;
import lombok.Getter;

/**
 * Object entry returned by storage list operations.
 */
@Getter
@Builder
public class StorageObject {

    private String bucketOrRoot;

    private String path;

    private Long size;

    private String contentType;

    private boolean isDir = false;
}
