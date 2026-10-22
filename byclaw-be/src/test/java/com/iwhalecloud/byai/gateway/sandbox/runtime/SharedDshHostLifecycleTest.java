package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.Set;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleFacade;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;

class SharedDshHostLifecycleTest {

    private final SharedDshHostLifecycle lifecycle =
        new SharedDshHostLifecycle(mock(SandboxLifecycleFacade.class), Set.of("u1")::contains);

    @Test
    void routesOnlyListedUsersDshSandboxes() {
        assertThat(lifecycle.routes("u1", "byclaw-dsh")).isTrue();
        assertThat(lifecycle.routes(" u1 ", "byclaw-dsh")).isTrue();
        assertThat(lifecycle.routes("u2", "byclaw-dsh")).isFalse();
        assertThat(lifecycle.routes("u1", "openclaw")).isFalse();
        assertThat(lifecycle.routes("", "byclaw-dsh")).isFalse();
        assertThat(lifecycle.routes(null, "byclaw-dsh")).isFalse();
    }

    @Test
    void ownsRecordsCarryingTheHostSandboxIdRegardlessOfTheList() {
        SsSandboxRecord hosted = new SsSandboxRecord();
        hosted.setUserCode("u2");
        hosted.setSandboxType("byclaw-dsh");
        hosted.setSandboxId("byclaw-dsh-u2");
        assertThat(lifecycle.owns(hosted)).as("an existing context keeps its runtime after the list changes").isTrue();

        SsSandboxRecord perUser = new SsSandboxRecord();
        perUser.setUserCode("u1");
        perUser.setSandboxType("byclaw-dsh");
        perUser.setSandboxId("byclaw-sandbox--byclaw-0123456789abcdef0123456789abcdef");
        assertThat(lifecycle.owns(perUser)).isFalse();

        SsSandboxRecord otherType = new SsSandboxRecord();
        otherType.setUserCode("u1");
        otherType.setSandboxType("openclaw");
        otherType.setSandboxId("byclaw-dsh-u1");
        assertThat(lifecycle.owns(otherType)).isFalse();
        assertThat(lifecycle.owns(null)).isFalse();
    }
}
