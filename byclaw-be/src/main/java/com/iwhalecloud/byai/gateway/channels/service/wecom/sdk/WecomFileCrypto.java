package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.util.Arrays;
import java.util.Base64;

/**
 * WeCom file decryption, ported from the reference SDK {@code src/crypto.ts}.
 * Pure and static so it is unit-testable with generated fixtures (plan §Task 7).
 *
 * <p>Deliberately NOT reusing {@code common.ecrypt.AesUtils}: that helper uses a
 * fixed IV and {@code AES/CBC/PKCS5Padding}, while WeCom requires the IV to come
 * from the decoded aeskey and requires manual PKCS#7 unpadding with a 1..32 pad
 * range (WeCom pads to a 32-byte multiple; standard 16-byte-block padding
 * helpers reject that). So: {@code AES/CBC/NoPadding} + manual unpad.
 */
public final class WecomFileCrypto {

    private WecomFileCrypto() {
    }

    /**
     * Decrypt a WeCom media payload.
     *
     * @param encrypted ciphertext bytes
     * @param aesKeyBase64 base64-encoded 32-byte AES key (from image/file/video aeskey)
     * @return decrypted plaintext bytes
     */
    public static byte[] decrypt(byte[] encrypted, String aesKeyBase64) {
        if (encrypted == null || encrypted.length == 0) {
            throw new IllegalArgumentException("encrypted payload is empty");
        }
        if (aesKeyBase64 == null || aesKeyBase64.isBlank()) {
            throw new IllegalArgumentException("aesKey must be a non-empty string");
        }

        byte[] key = Base64.getDecoder().decode(aesKeyBase64);
        if (key.length != 32) {
            throw new IllegalArgumentException("aesKey must decode to 32 bytes, got " + key.length);
        }
        byte[] iv = Arrays.copyOfRange(key, 0, 16);

        byte[] decrypted;
        try {
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
            decrypted = cipher.doFinal(encrypted);
        } catch (Exception e) {
            throw new IllegalStateException("WeCom file decryption failed (corrupted data or wrong aesKey)", e);
        }

        return removePkcs7Padding(decrypted);
    }

    /**
     * Remove PKCS#7 padding where the pad length is valid in {@code 1..32}
     * (WeCom-specific range, mirroring {@code crypto.ts}). Validates that every
     * padding byte equals the pad length.
     */
    static byte[] removePkcs7Padding(byte[] data) {
        if (data.length == 0) {
            throw new IllegalStateException("cannot unpad empty data");
        }
        int padLen = data[data.length - 1] & 0xFF;
        if (padLen < 1 || padLen > 32 || padLen > data.length) {
            throw new IllegalStateException("Invalid PKCS#7 padding value: " + padLen);
        }
        for (int i = data.length - padLen; i < data.length; i++) {
            if ((data[i] & 0xFF) != padLen) {
                throw new IllegalStateException("Invalid PKCS#7 padding: padding bytes mismatch");
            }
        }
        return Arrays.copyOfRange(data, 0, data.length - padLen);
    }
}
