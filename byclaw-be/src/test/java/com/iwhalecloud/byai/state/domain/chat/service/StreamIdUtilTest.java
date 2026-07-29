package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StreamIdUtilTest {

    @Test
    void compareByMillisFirst() {
        assertTrue(StreamIdUtil.compare("100-0", "200-0") < 0);
        assertTrue(StreamIdUtil.compare("200-0", "100-0") > 0);
    }

    @Test
    void compareBySeqWhenMillisEqual() {
        assertTrue(StreamIdUtil.compare("100-1", "100-2") < 0);
        assertTrue(StreamIdUtil.compare("100-5", "100-2") > 0);
        assertEquals(0, StreamIdUtil.compare("100-3", "100-3"));
    }

    @Test
    void missingSeqDefaultsToZero() {
        assertEquals(0, StreamIdUtil.compare("100", "100-0"));
        assertTrue(StreamIdUtil.compare("100", "100-1") < 0);
    }

    @Test
    void nullOrBlankIsNotComparable() {
        assertEquals(0, StreamIdUtil.compare(null, "100-0"));
        assertEquals(0, StreamIdUtil.compare("100-0", null));
        assertEquals(0, StreamIdUtil.compare("", "100-0"));
    }

    @Test
    void illegalFormatIsNotComparable() {
        assertEquals(0, StreamIdUtil.compare("abc", "100-0"));
        assertEquals(0, StreamIdUtil.compare("100-x", "100-0"));
    }

    @Test
    void largeMillisDoesNotOverflow() {
        assertTrue(StreamIdUtil.compare("1690000000000-0", "1690000000001-0") < 0);
        assertEquals(0, StreamIdUtil.compare("1690000000000-7", "1690000000000-7"));
    }

    @Test
    void isProcessedSkipsAtOrBelowWatermark() {
        assertTrue(StreamIdUtil.isProcessedByWatermark("100-0", "100-0"));
        assertTrue(StreamIdUtil.isProcessedByWatermark("50-0", "100-0"));
        assertTrue(StreamIdUtil.isProcessedByWatermark("100-1", "100-2"));
    }

    @Test
    void isProcessedDoesNotSkipAboveWatermark() {
        assertFalse(StreamIdUtil.isProcessedByWatermark("101-0", "100-0"));
        assertFalse(StreamIdUtil.isProcessedByWatermark("100-3", "100-2"));
    }

    @Test
    void isProcessedNeverSkipsWhenNotComparable() {
        // 不可解析一律不跳过，避免误丢真实事件（#2）。
        assertFalse(StreamIdUtil.isProcessedByWatermark("abc", "100-0"));
        assertFalse(StreamIdUtil.isProcessedByWatermark("100-0", "xyz"));
        assertFalse(StreamIdUtil.isProcessedByWatermark(null, "100-0"));
        assertFalse(StreamIdUtil.isProcessedByWatermark("100-0", null));
        assertFalse(StreamIdUtil.isProcessedByWatermark("", ""));
    }

    @Test
    void maxKeepsMonotonic() {
        assertEquals("100-0", StreamIdUtil.max("100-0", "50-0", "fallback"));
        assertEquals("100-0", StreamIdUtil.max("50-0", "100-0", "fallback"));
        assertEquals("100-5", StreamIdUtil.max("100-5", "100-2", "fallback"));
        // 不可解析的一方被忽略，返回可解析的另一方。
        assertEquals("100-0", StreamIdUtil.max("100-0", "bad", "fallback"));
        assertEquals("100-0", StreamIdUtil.max("bad", "100-0", "fallback"));
        // 两边都不可解析时返回 fallback。
        assertEquals("fallback", StreamIdUtil.max("bad", null, "fallback"));
    }
}
