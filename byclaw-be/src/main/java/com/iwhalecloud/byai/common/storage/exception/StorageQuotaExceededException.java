package com.iwhalecloud.byai.common.storage.exception;

/** Raised when a user write cannot be admitted by the storage quota ledger. */
public class StorageQuotaExceededException extends RuntimeException {

    public StorageQuotaExceededException(String message) {
        super(message);
    }
}
