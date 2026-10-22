package com.iwhalecloud.byai.gateway.sandbox.runtime;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class SandboxRuntimeOwnershipTest {
    @Test void gatewayCompatibleIdsRemainForeignToOpenSandbox() {
        String id="byclaw-sandbox--byclaw-0123456789abcdef0123456789abcdef";
        assertTrue(SandboxRuntimeOwnership.isForeign("opensandbox",id));
        assertFalse(SandboxRuntimeOwnership.isForeign("aliyunAgentSandbox",id));
    }
    @Test void qualifiedAcsIdIsForeignToLegacyProviders() {
        String id="test-ns--byclaw-0123456789abcdef0123456789abcdef01234567";
        assertTrue(SandboxRuntimeOwnership.isForeign("opensandbox",id));
        assertTrue(SandboxRuntimeOwnership.isForeign("whaleagent",id));
        assertFalse(SandboxRuntimeOwnership.isForeign("aliyunAgentSandbox",id));
    }
    @Test void legacyIdsAndUnassignedRecordsKeepTheirExistingBehavior() {
        assertFalse(SandboxRuntimeOwnership.isForeign("opensandbox","6548125a-e6b7-4524-aee9-c762957d7e15"));
        assertFalse(SandboxRuntimeOwnership.isForeign("opensandbox","sandbox-old"));
        assertFalse(SandboxRuntimeOwnership.isForeign("opensandbox",null));
        assertFalse(SandboxRuntimeOwnership.isForeign("aliyunAgentSandbox",null));
        assertTrue(SandboxRuntimeOwnership.isForeign("aliyunAgentSandbox","sandbox-old"));
    }
}
