package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class SandboxTargetRoutingTest {
    @Test void finalDshTargetOverridesSuperResourceAndPreferredOpenclawWithoutRequery() {
        AtomicInteger lookups=new AtomicInteger();
        SandboxLaunchRouting route=SandboxTargetRouting.resolve("u","BYCLAW_DSH_u",()->{
            lookups.incrementAndGet(); return new SandboxLaunchRouting("openclaw-xs",-1L);
        });
        assertEquals("byclaw-dsh",route.getSandboxType());
        assertEquals(-1L,route.getEffectiveResourceId()); assertEquals(0,lookups.get());
    }
    @Test void harnessAliasUsesTheSameDshRecordKey() {
        assertEquals("byclaw-dsh",SandboxTargetRouting.resolve("u","HARNESS_u",()->null).getSandboxType());
    }
    @Test void codeTargetKeepsOriginalCodeResourceKey() {
        SandboxLaunchRouting route=SandboxTargetRouting.resolve("u","BYCLAW_CODE_u",()->null);
        assertEquals("byclaw-code-agent",route.getSandboxType()); assertEquals(-2L,route.getEffectiveResourceId());
    }
    @Test void explicitOpenclawKeepsItsPreferredProfile() {
        SandboxLaunchRouting original=new SandboxLaunchRouting("openclaw-xs",99L);
        assertSame(original,SandboxTargetRouting.resolve("u","BYCLAW_EXE_u",()->original));
        assertEquals("xs",original.getProfileKey()); assertEquals(-1L,original.getEffectiveResourceId());
    }
    @Test void explicitOpenclawCannotBeReplacedByHarnessResourceOrOtherPreferredType() {
        SandboxLaunchRouting route=SandboxTargetRouting.resolve("u","BYCLAW_EXE_u",()->new SandboxLaunchRouting("byclaw-dsh",-1L));
        assertEquals("openclaw",route.getSandboxType()); assertNull(route.getProfileKey());
    }
    @Test void nonUserTargetsAndOtherUsersCannotChangeManagementRouting() {
        SandboxLaunchRouting original=new SandboxLaunchRouting("custom",44L);
        for(String target:new String[]{null,"BY_SUPER","BYCLAW_DSH_someone","BYCLAW_DSH_u_extra"})
            assertSame(original,SandboxTargetRouting.resolve("u",target,()->original));
        assertSame(original,SandboxTargetRouting.resolve(null,"BYCLAW_DSH_u",()->original));
    }
}
