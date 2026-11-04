package com.iwhalecloud.byai.state.domain.sys.service;

import com.iwhalecloud.byai.manager.mapper.system.SequenceMapper;
import com.iwhalecloud.byai.state.database.ByaiDruidProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
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
    void allocatesSequenceValuesInOneRoundTrip(String dbType) {
        when(properties.getDbType()).thenReturn(dbType);
        when(mapper.nextValuesForPostgreSql("seq_any_table", 3)).thenReturn(java.util.List.of(11L, 12L, 13L));
        assertThat(service.nextValues(3)).containsExactly(11L, 12L, 13L);
        verify(mapper).nextValuesForPostgreSql("seq_any_table", 3);
    }

    @Test
    void retainsOtherDatabaseIdStrategy() {
        when(properties.getDbType()).thenReturn("oracle");
        when(mapper.nextValuesForOracle("seq_any_table", 2)).thenReturn(java.util.List.of(4L, 5L));
        assertThat(service.nextValues(2)).containsExactly(4L, 5L);
    }

    @Test
    void rejectsDuplicateOrNullIdsBeforeInsertAndValidatesBatchSize() {
        when(properties.getDbType()).thenReturn("postgresql");
        when(mapper.nextValuesForPostgreSql("seq_any_table", 2)).thenReturn(java.util.List.of(1L, 1L), java.util.Arrays.asList(1L, null));
        for (int attempt = 0; attempt < 2; attempt++) {
            assertThatThrownBy(() -> service.nextValues(2)).isInstanceOf(IllegalStateException.class);
        }
        assertThat(service.nextValues(0)).isEmpty();
        assertThatThrownBy(() -> service.nextValues(-1)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test
    void allocates45000IdsWith90DatabaseCallsInsteadOf45000() {
        when(properties.getDbType()).thenReturn("postgresql");
        java.util.concurrent.atomic.AtomicLong sequence = new java.util.concurrent.atomic.AtomicLong();
        when(mapper.nextValuesForPostgreSql("seq_any_table", 500)).thenAnswer(call ->
            java.util.stream.LongStream.range(0, 500).map(i -> sequence.incrementAndGet()).boxed().toList());
        assertThat(service.nextValues(45000)).hasSize(45000).doesNotHaveDuplicates();
        verify(mapper, times(90)).nextValuesForPostgreSql("seq_any_table", 500);
        org.mockito.Mockito.verify(mapper, org.mockito.Mockito.never()).nextValForPostgreSql(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void actualMapperAllocatesDistinctIdsAcrossChunkBoundary() throws Exception {
        var source = new org.apache.ibatis.datasource.unpooled.UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:sequence_" + java.util.UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        try (var connection = source.getConnection(); var statement = connection.createStatement()) {
            statement.execute("CREATE SEQUENCE seq_any_table START WITH 1");
        }
        var configuration = new org.apache.ibatis.session.Configuration(new org.apache.ibatis.mapping.Environment(
            "test", new org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory(), source));
        String resource = "com/iwhalecloud/byai/manager/mapper/system/SequenceMapper.xml";
        try (var xml = getClass().getClassLoader().getResourceAsStream(resource)) {
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(xml, configuration, resource,
                configuration.getSqlFragments()).parse();
        }
        try (var session = new org.apache.ibatis.session.SqlSessionFactoryBuilder().build(configuration).openSession()) {
            ReflectionTestUtils.setField(service, "sequenceMapper", session.getMapper(SequenceMapper.class));
            when(properties.getDbType()).thenReturn("opengauss");
            assertThat(service.nextValues(501)).hasSize(501).doesNotHaveDuplicates().doesNotContainNull();
        }
    }

}
