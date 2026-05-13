package com.iwhalecloud.byai.common.storage.util;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import com.iwhalecloud.byai.common.exception.BaseException;

class MinioBucketNameValidatorTest {

    @ParameterizedTest
    @ValueSource(strings = {"byclaw", "Byclaw", "byclaw-User001", "A1", "a-b-c-123"})
    void validate_allowsLettersDigitsAndMiddleHyphens(String bucketName) {
        assertDoesNotThrow(() -> MinioBucketNameValidator.validate(bucketName));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void validate_rejectsBlankBucketName(String bucketName) {
        assertThrows(BaseException.class, () -> MinioBucketNameValidator.validate(bucketName));
    }

    @ParameterizedTest
    @ValueSource(strings = {"-byclaw", "byclaw-", "by_claw", "by.claw", "by/claw", "by claw"})
    void validate_rejectsIllegalBucketName(String bucketName) {
        assertThrows(BaseException.class, () -> MinioBucketNameValidator.validate(bucketName));
    }
}
