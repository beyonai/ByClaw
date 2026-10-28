package com.iwhalecloud.byai.common.util;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisSetBatchTest {
    private Object original;
    private StringRedisTemplate template;
    private SetOperations<String, String> sets;
    private final Map<String, Set<String>> stored = new LinkedHashMap<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        original = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        template = mock(StringRedisTemplate.class);
        sets = mock(SetOperations.class);
        when(template.opsForSet()).thenReturn(sets);
        when(sets.add(anyString(), any(String[].class))).thenAnswer(call -> {
            Set<String> members = stored.computeIfAbsent(call.getArgument(0), ignored -> new LinkedHashSet<>());
            int before = members.size();
            for (int i = 1; i < call.getArguments().length; i++) members.add(call.getArgument(i));
            return (long) members.size() - before;
        });
        when(template.executePipelined(any(SessionCallback.class))).thenAnswer(call -> {
            int before = org.mockito.Mockito.mockingDetails(sets).getInvocations().size();
            call.getArgument(0, SessionCallback.class).execute(template);
            int commands = org.mockito.Mockito.mockingDetails(sets).getInvocations().size() - before;
            return new ArrayList<>(java.util.Collections.nCopies(commands, 1L));
        });
        RedisUtil util = new RedisUtil();
        ReflectionTestUtils.setField(util, "stringRedisTemplate", template);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", util);
    }

    @AfterEach
    void restore() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", original);
    }

    @Test
    void writesAllUsersInBoundedPipelinesAndKeepsExistingMembers() {
        Map<String, Set<String>> expected = additions(501);
        stored.put("user:0", new LinkedHashSet<>(Set.of("existing")));
        RedisUtil.addSets(expected);
        verify(template, times(2)).executePipelined(any(SessionCallback.class));
        expected.forEach((key, values) -> assertThat(stored.get(key)).containsAll(values));
        assertThat(stored.get("user:0")).contains("existing");
        assertThat(stored).hasSize(501);
    }

    @Test
    @SuppressWarnings("unchecked")
    void replaysPartialPipelineWithoutDuplicatingOrDroppingMembers() {
        Map<String, Set<String>> expected = additions(3);
        org.mockito.Mockito.doAnswer(call -> {
            sets.add("user:0", "SKILL_1", "SKILL_2");
            throw new RedisSystemException("connection lost after first command", null);
        }).when(template).executePipelined(any(SessionCallback.class));
        RedisUtil.addSets(expected);
        assertThat(stored).isEqualTo(expected);
        assertThat(stored.get("user:0")).hasSize(2);
    }

    @Test
    @SuppressWarnings("unchecked")
    void persistentRedisFailureIsNotReportedAsSuccess() {
        org.mockito.Mockito.doThrow(new RedisSystemException("pipeline unavailable", null))
            .when(template).executePipelined(any(SessionCallback.class));
        org.mockito.Mockito.doThrow(new RedisSystemException("Redis unavailable", null))
            .when(sets).add(anyString(), any(String[].class));
        assertThatThrownBy(() -> RedisUtil.addSets(additions(2))).isInstanceOf(RedisSystemException.class)
            .hasMessageContaining("replay failed");
    }

    private Map<String, Set<String>> additions(int count) {
        Map<String, Set<String>> values = new LinkedHashMap<>();
        for (int i = 0; i < count; i++) values.put("user:" + i, Set.of("SKILL_1", "SKILL_2"));
        return values;
    }
}
