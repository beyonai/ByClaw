package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 验证 ACK 失败登记表的登记、清除与上限保护。
 */
class StreamAckFailureRegistryTest {

    private static final String STREAM_KEY = "byai_gateway:session:10:data_stream";

    private StreamAckFailureRegistry registry;

    @BeforeEach
    void setUp() {
        registry = new StreamAckFailureRegistry();
    }

    @Test
    void recordsAndReportsFailures() {
        assertThat(registry.hasFailures(STREAM_KEY)).isFalse();

        registry.record(STREAM_KEY, "100-0");
        registry.record(STREAM_KEY, "101-0");

        assertThat(registry.hasFailures(STREAM_KEY)).isTrue();
        assertThat(registry.snapshot(STREAM_KEY)).containsExactlyInAnyOrder("100-0", "101-0");
    }

    @Test
    void clearRemovesSingleEntryAndReclaimsEmptySet() {
        registry.record(STREAM_KEY, "100-0");
        registry.record(STREAM_KEY, "101-0");

        registry.clear(STREAM_KEY, "100-0");
        assertThat(registry.snapshot(STREAM_KEY)).containsExactly("101-0");

        registry.clear(STREAM_KEY, "101-0");
        assertThat(registry.hasFailures(STREAM_KEY)).isFalse();
        assertThat(registry.snapshot(STREAM_KEY)).isEmpty();
    }

    @Test
    void clearAllDropsWholeStream() {
        registry.record(STREAM_KEY, "100-0");

        registry.clearAll(STREAM_KEY);

        assertThat(registry.hasFailures(STREAM_KEY)).isFalse();
    }

    @Test
    void snapshotIsIsolatedFromLaterWrites() {
        registry.record(STREAM_KEY, "100-0");
        var snapshot = registry.snapshot(STREAM_KEY);

        registry.record(STREAM_KEY, "101-0");

        assertThat(snapshot).containsExactly("100-0");
    }

    @Test
    void stopsRecordingBeyondPerStreamLimit() {
        for (int index = 0; index < 300; index++) {
            registry.record(STREAM_KEY, index + "-0");
        }

        assertThat(registry.snapshot(STREAM_KEY)).hasSize(256);
    }

    @Test
    void ignoresNullArguments() {
        registry.record(null, "100-0");
        registry.record(STREAM_KEY, null);

        assertThat(registry.hasFailures(STREAM_KEY)).isFalse();
        assertThat(registry.snapshot(null)).isEmpty();
    }
}
