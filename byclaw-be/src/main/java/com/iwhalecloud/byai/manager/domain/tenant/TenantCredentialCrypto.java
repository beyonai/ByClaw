package com.iwhalecloud.byai.manager.domain.tenant;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.security.Security;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Mac;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.util.encoders.Hex;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

/** SM4-GCM envelope for a tenant DB password using a deployment secret and a tenant-derived key. */
@Component
public class TenantCredentialCrypto {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder PASSWORD_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Encoder ENVELOPE_ENCODER = Base64.getEncoder();
    private static final int NONCE_LENGTH = 12;
    private static final int TAG_LENGTH = 16;
    private static final String KEY_ID = "byclaw-sm4-v2";
    private static final String LEGACY_KEY_ID = "byclaw-sm4-v1";

    static {
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
    }

    private final ObjectMapper objectMapper;
    private final byte[] masterKey;

    public TenantCredentialCrypto(ObjectMapper objectMapper,
                                  @Value("${BYCLAW_TENANT_CREDENTIAL_MASTER_KEY:}") String masterKeyHex) {
        this.objectMapper = objectMapper;
        if (masterKeyHex == null || masterKeyHex.isBlank()) {
            this.masterKey = null;
        }
        else if (!masterKeyHex.matches("[0-9a-fA-F]{64}")) {
            throw new IllegalArgumentException("BYCLAW_TENANT_CREDENTIAL_MASTER_KEY must be 64 hex characters");
        }
        else {
            this.masterKey = Hex.decode(masterKeyHex);
        }
    }

    public String newPassword() {
        // OpenGauss rejects passwords longer than 32 characters. Twenty random bytes
        // encode to 27 base64url characters, leaving room for a required symbol.
        byte[] random = new byte[20];
        String password;
        do {
            RANDOM.nextBytes(random);
            // OpenGauss requires a punctuation character as well as mixed case and digits.
            password = PASSWORD_ENCODER.encodeToString(random) + "@";
        } while (!password.matches(".*[A-Z].*") || !password.matches(".*[a-z].*")
            || !password.matches(".*[0-9].*"));
        return password;
    }

    public boolean isOpenGaussCompatible(String password) {
        return password != null && password.length() >= 8 && password.length() <= 32
            && password.matches(".*[A-Z].*") && password.matches(".*[a-z].*")
            && password.matches(".*[0-9].*") && password.matches(".*[^A-Za-z0-9].*");
    }

    public String encrypt(long enterpriseId, String dbName, String password) {
        validate(enterpriseId, dbName);
        byte[] tenantKey = deriveTenantKey(enterpriseId);
        if (password == null || password.isEmpty()) {
            throw new IllegalArgumentException("tenant DB password is required");
        }
        byte[] nonce = new byte[NONCE_LENGTH];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance("SM4/GCM/NoPadding", BouncyCastleProvider.PROVIDER_NAME);
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(tenantKey, "SM4"),
                new GCMParameterSpec(TAG_LENGTH * Byte.SIZE, nonce));
            cipher.updateAAD(aad(enterpriseId, dbName));
            byte[] sealed = cipher.doFinal(password.getBytes(StandardCharsets.UTF_8));
            int ciphertextLength = sealed.length - TAG_LENGTH;
            Envelope envelope = new Envelope("SM4-GCM", KEY_ID, ENVELOPE_ENCODER.encodeToString(nonce),
                ENVELOPE_ENCODER.encodeToString(Arrays.copyOf(sealed, ciphertextLength)),
                ENVELOPE_ENCODER.encodeToString(Arrays.copyOfRange(sealed, ciphertextLength, sealed.length)));
            return objectMapper.writeValueAsString(envelope);
        }
        catch (GeneralSecurityException | JsonProcessingException e) {
            throw new IllegalStateException("tenant credential encryption failed", e);
        }
    }

    public String decrypt(long enterpriseId, String dbName, String envelopeJson) throws GeneralSecurityException {
        validate(enterpriseId, dbName);
        try {
            Envelope envelope = objectMapper.readValue(envelopeJson, Envelope.class);
            if (!"SM4-GCM".equals(envelope.alg())
                || !(KEY_ID.equals(envelope.keyId()) || LEGACY_KEY_ID.equals(envelope.keyId()))) {
                throw new GeneralSecurityException("tenant credential key mismatch");
            }
            byte[] tenantKey = LEGACY_KEY_ID.equals(envelope.keyId())
                ? Sm4Util.deriveTenantCredentialKey(enterpriseId) : deriveTenantKey(enterpriseId);
            Base64.Decoder decoder = LEGACY_KEY_ID.equals(envelope.keyId())
                ? Base64.getUrlDecoder() : Base64.getDecoder();
            byte[] nonce = decoder.decode(envelope.nonce());
            byte[] ciphertext = decoder.decode(envelope.ciphertext());
            byte[] tag = decoder.decode(envelope.tag());
            if (nonce.length != NONCE_LENGTH || tag.length != TAG_LENGTH) {
                throw new GeneralSecurityException("invalid tenant credential envelope");
            }
            byte[] sealed = Arrays.copyOf(ciphertext, ciphertext.length + tag.length);
            System.arraycopy(tag, 0, sealed, ciphertext.length, tag.length);
            Cipher cipher = Cipher.getInstance("SM4/GCM/NoPadding", BouncyCastleProvider.PROVIDER_NAME);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(tenantKey, "SM4"),
                new GCMParameterSpec(TAG_LENGTH * Byte.SIZE, nonce));
            cipher.updateAAD(aad(enterpriseId, dbName));
            return new String(cipher.doFinal(sealed), StandardCharsets.UTF_8);
        }
        catch (JsonProcessingException | IllegalArgumentException | NullPointerException e) {
            throw new GeneralSecurityException("invalid tenant credential envelope", e);
        }
    }

    byte[] deriveTenantKey(long enterpriseId) {
        if (enterpriseId <= 0) {
            throw new IllegalArgumentException("enterprise ID must be positive");
        }
        if (masterKey == null) {
            throw new IllegalStateException("BYCLAW_TENANT_CREDENTIAL_MASTER_KEY is required for tenant credentials");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(masterKey, "HmacSHA256"));
            return Arrays.copyOf(mac.doFinal(("byclaw:tenant-db-credential:v2:" + enterpriseId)
                .getBytes(StandardCharsets.UTF_8)), 16);
        }
        catch (GeneralSecurityException e) {
            throw new IllegalStateException("tenant credential key derivation failed", e);
        }
    }

    private void validate(long enterpriseId, String dbName) {
        if (enterpriseId <= 0 || !("byclaw_t_" + enterpriseId).equals(dbName)) {
            throw new IllegalArgumentException("invalid tenant database identity");
        }
    }

    private byte[] aad(long enterpriseId, String dbName) {
        return ("byclaw:tenant-db:v1:" + enterpriseId + ":" + dbName).getBytes(StandardCharsets.UTF_8);
    }

    private record Envelope(String alg, String keyId, String nonce, String ciphertext, String tag) {
    }
}
