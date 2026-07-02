package com.iwhalecloud.byai.state.domain.chat.service;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encodes two message ids into the Langfuse-compatible 32-character lowercase hex trace id by AES.
 */
public final class TraceIdCodec {

    private static final int LONG_BYTES = 8;

    private static final int TRACE_BYTES = LONG_BYTES * 2;

    private static final String AES_TRANSFORMATION = "AES/ECB/NoPadding";

    private static final String AES_ALGORITHM = "AES";

    private static final byte[] DEFAULT_AES_KEY = "ByClawTraceKey1!".getBytes(StandardCharsets.UTF_8);

    private static final Pattern LEGACY_TRACE_ID = Pattern.compile("^\\d+_\\d+$");

    private static final Pattern HEX_TRACE_ID = Pattern.compile("^[0-9a-f]{32}$");

    private static final char[] HEX_CHARS = "0123456789abcdef".toCharArray();

    private static final byte[] AES_KEY = resolveAesKey();

    private TraceIdCodec() {
    }

    public static String encode(Long userMessageId, Long modelAnswerMessageId) {
        if (userMessageId == null || modelAnswerMessageId == null) {
            throw new IllegalArgumentException("message ids must not be null");
        }
        validateMessageId(userMessageId);
        validateMessageId(modelAnswerMessageId);

        ByteBuffer plaintext = ByteBuffer.allocate(TRACE_BYTES);
        plaintext.putLong(userMessageId);
        plaintext.putLong(modelAnswerMessageId);
        return toHex(crypt(Cipher.ENCRYPT_MODE, plaintext.array()));
    }

    public static TraceMessageIds decode(String traceId) {
        if (traceId == null) {
            throw new IllegalArgumentException("traceId must not be null");
        }

        String normalizedTraceId = traceId.trim();
        if (LEGACY_TRACE_ID.matcher(normalizedTraceId).matches()) {
            String[] parts = normalizedTraceId.split("_", 2);
            return new TraceMessageIds(Long.parseLong(parts[0]), Long.parseLong(parts[1]));
        }
        if (HEX_TRACE_ID.matcher(normalizedTraceId).matches()) {
            ByteBuffer plaintext = ByteBuffer.wrap(crypt(Cipher.DECRYPT_MODE, fromHex(normalizedTraceId)));
            Long userMessageId = plaintext.getLong();
            Long modelAnswerMessageId = plaintext.getLong();
            validateMessageId(userMessageId);
            validateMessageId(modelAnswerMessageId);
            return new TraceMessageIds(userMessageId, modelAnswerMessageId);
        }

        throw new IllegalArgumentException("invalid traceId format: " + traceId);
    }

    public static boolean canDecode(String traceId) {
        try {
            decode(traceId);
            return true;
        }
        catch (RuntimeException e) {
            return false;
        }
    }

    private static void validateMessageId(Long value) {
        if (value < 0) {
            throw new IllegalArgumentException("message id must not be negative");
        }
    }

    private static byte[] crypt(int mode, byte[] input) {
        try {
            Cipher cipher = Cipher.getInstance(AES_TRANSFORMATION);
            cipher.init(mode, new SecretKeySpec(AES_KEY, AES_ALGORITHM));
            return cipher.doFinal(input);
        }
        catch (GeneralSecurityException e) {
            throw new IllegalStateException("traceId AES codec failed", e);
        }
    }

    private static String toHex(byte[] bytes) {
        char[] chars = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xff;
            chars[i * 2] = HEX_CHARS[value >>> 4];
            chars[i * 2 + 1] = HEX_CHARS[value & 0x0f];
        }
        return new String(chars);
    }

    private static byte[] fromHex(String value) {
        byte[] bytes = new byte[value.length() / 2];
        for (int i = 0; i < value.length(); i += 2) {
            bytes[i / 2] = (byte)Integer.parseInt(value.substring(i, i + 2), 16);
        }
        return bytes;
    }

    private static byte[] resolveAesKey() {
        return DEFAULT_AES_KEY.clone();
    }

    // private static boolean isHexKey(String value) {
    //     return (value.length() == 32 || value.length() == 48 || value.length() == 64)
    //         && value.matches("^[0-9a-fA-F]+$");
    // }

    // private static boolean isValidAesKeyLength(int length) {
    //     return length == 16 || length == 24 || length == 32;
    // }

    public static final class TraceMessageIds {

        private final Long userMessageId;

        private final Long modelAnswerMessageId;

        private TraceMessageIds(Long userMessageId, Long modelAnswerMessageId) {
            this.userMessageId = userMessageId;
            this.modelAnswerMessageId = modelAnswerMessageId;
        }

        public Long getUserMessageId() {
            return userMessageId;
        }

        public Long getModelAnswerMessageId() {
            return modelAnswerMessageId;
        }
    }
}
