package com.iwhalecloud.byai.state.domain.sys.service;

import com.iwhalecloud.byai.manager.mapper.system.SequenceMapper;
import com.iwhalecloud.byai.state.database.ByaiDruidProperties;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SequenceServiceBatchTest {
    private final SequenceMapper mapper = mock(SequenceMapper.class);
    private final ByaiDruidProperties properties = mock(ByaiDruidProperties.class);
    private final SequenceService service = new SequenceService();

    SequenceServiceBatchTest() {
        ReflectionTestUtils.setField(service, "sequenceMapper", mapper);
        ReflectionTestUtils.setField(service, "byaiDruidProperties", properties);
        ReflectionTestUtils.setField(service, "defaultSequenceName", "seq_any_table");
    }

    @ParameterizedTest
    @ValueSource(strings = {"postgresql", "opengauss"})
    void fetchesBatchFromOriginalSequenceInOneCall(String dbType) {
        when(properties.getDbType()).thenReturn(dbType);
        when(mapper.nextValuesForPostgreSql("seq_any_table", 3)).thenReturn(List.of(11L, 12L, 13L));
        assertThat(service.nextValues(3)).containsExactly(11L, 12L, 13L);
        verify(mapper).nextValuesForPostgreSql("seq_any_table", 3);
        verify(mapper, never()).nextValForPostgreSql("seq_any_table");
    }

    @Test
    void retainsOtherDatabaseIdStrategy() {
        when(properties.getDbType()).thenReturn("oracle");
        when(mapper.nextValForOracle("seq_any_table")).thenReturn(4L, 5L);
        assertThat(service.nextValues(2)).containsExactly(4L, 5L);
    }

    @Test
    void rejectsIncompleteDuplicateAndNullIdsBeforeInsert() {
        when(properties.getDbType()).thenReturn("postgresql");
        when(mapper.nextValuesForPostgreSql("seq_any_table", 2))
            .thenReturn(List.of(1L), List.of(1L, 1L), Arrays.asList(1L, null));
        for (int attempt = 0; attempt < 3; attempt++) {
            assertThatThrownBy(() -> service.nextValues(2)).isInstanceOf(IllegalStateException.class);
        }
        assertThat(service.nextValues(0)).isEmpty();
        assertThatThrownBy(() -> service.nextValues(-1)).isInstanceOf(IllegalArgumentException.class);
    }
}
