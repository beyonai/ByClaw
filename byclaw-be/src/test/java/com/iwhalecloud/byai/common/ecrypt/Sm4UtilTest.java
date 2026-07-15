package com.iwhalecloud.byai.common.ecrypt;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class Sm4UtilTest {

    private static final String PLAINTEXT = "frontend-compatible";

    private static final String FRONTEND_COMPATIBLE_CIPHERTEXT =
        "bPejoH59JYrEleZbo2hFpJrqgfxGycjlkmZxVKrZ0E8=";

    @Test
    void shouldEncryptWithFrontendCompatibleSm4EcbPadding() {
        assertEquals(FRONTEND_COMPATIBLE_CIPHERTEXT, Sm4Util.encrypt(PLAINTEXT));
    }

    @Test
    void shouldDecryptFrontendCompatibleSm4EcbPadding() {
        assertEquals(PLAINTEXT, Sm4Util.decrypt(FRONTEND_COMPATIBLE_CIPHERTEXT));
    }
}
