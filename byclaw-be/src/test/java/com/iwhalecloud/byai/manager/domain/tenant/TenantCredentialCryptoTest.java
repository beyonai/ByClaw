package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.GeneralSecurityException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;

class TenantCredentialCryptoTest {

    private final TenantCredentialCrypto crypto = new TenantCredentialCrypto(new ObjectMapper(),
        "890901bc116178263b4741198097513902f420e9064be71627609412534e3039");

    @Test
    void passwordEnvelopeRoundTripsAndBindsEnterpriseAndDatabase() throws Exception {
        String password = crypto.newPassword();
        String envelope = crypto.encrypt(123L, "byclaw_t_123", password);

        assertThat(password).hasSize(28).endsWith("@");
        assertThat(crypto.isOpenGaussCompatible(password)).isTrue();
        assertThat(crypto.isOpenGaussCompatible(password + "12345")).isFalse();
        assertThat(envelope).contains("SM4-GCM", "byclaw-sm4-v2").doesNotContain(password);
        assertThat(crypto.decrypt(123L, "byclaw_t_123", envelope))
            .isEqualTo(password);
        assertThatThrownBy(() -> crypto.decrypt(124L, "byclaw_t_124", envelope))
            .isInstanceOf(GeneralSecurityException.class);
    }

    @Test
    void derivedKeysAreStablePerTenantAndSeparatedBetweenTenants() {
        assertThat(crypto.deriveTenantKey(123L)).hasSize(16).containsExactly(crypto.deriveTenantKey(123L));
        assertThat(crypto.deriveTenantKey(123L)).isNotEqualTo(crypto.deriveTenantKey(124L));
    }

    @Test
    void newCredentialsRequireDeploymentSecret() {
        TenantCredentialCrypto withoutSecret = new TenantCredentialCrypto(new ObjectMapper(), "");
        assertThatThrownBy(() -> withoutSecret.encrypt(123L, "byclaw_t_123", "Password1@"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("BYCLAW_TENANT_CREDENTIAL_MASTER_KEY");
    }

    @Test
    void decryptsLegacyEnvelopeDuringCredentialRotation() throws Exception {
        byte[] nonce = new byte[12];
        Cipher cipher = Cipher.getInstance("SM4/GCM/NoPadding", BouncyCastleProvider.PROVIDER_NAME);
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(Sm4Util.deriveTenantCredentialKey(123L), "SM4"),
            new GCMParameterSpec(128, nonce));
        cipher.updateAAD("byclaw:tenant-db:v1:123:byclaw_t_123".getBytes(StandardCharsets.UTF_8));
        byte[] sealed = cipher.doFinal("LegacyPassword1@".getBytes(StandardCharsets.UTF_8));
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String envelope = new ObjectMapper().writeValueAsString(new LegacyEnvelope("SM4-GCM", "byclaw-sm4-v1",
            encoder.encodeToString(nonce), encoder.encodeToString(Arrays.copyOf(sealed, sealed.length - 16)),
            encoder.encodeToString(Arrays.copyOfRange(sealed, sealed.length - 16, sealed.length))));

        assertThat(crypto.decrypt(123L, "byclaw_t_123", envelope)).isEqualTo("LegacyPassword1@");
    }

    private record LegacyEnvelope(String alg, String keyId, String nonce, String ciphertext, String tag) {
    }
}
