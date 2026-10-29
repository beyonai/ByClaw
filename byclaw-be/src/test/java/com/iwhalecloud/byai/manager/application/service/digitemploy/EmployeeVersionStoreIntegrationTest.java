package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.manager.dto.digitemploy.*;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.nio.file.*;
import java.sql.DriverManager;
import java.util.*;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** 实际迁移 SQL + MyBatis Mapper，验证版本指针、唯一约束、CAS 及事务回滚。 */
class EmployeeVersionStoreIntegrationTest {
    SqlSession session;
    EmployeeVersionStore store;
    SsResourceMapper resources;
    long next = 100;
    @BeforeEach void setup() throws Exception {
        String url = "jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        var config = new MybatisConfiguration(new Environment("versions", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.h2.Driver", url, null, null)));
        config.addMapper(SsResourceMapper.class); config.addMapper(SsResourceVersionMapper.class);
        config.addMapper(EmployeeVersionRelationMapper.class); config.addMapper(EmployeeVersionActivationMapper.class);
        Set<String> newColumns = Set.of("config_version_seq", "config_revision", "pending_activation_id", "version_seq",
            "base_version_id", "source_version_id", "snapshot_schema_version", "content_hash", "version_source", "change_note", "save_request_id", "saved_revision");
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE SCHEMA byai"); sql.execute("SET SCHEMA byai");
            for (Class<?> entity : List.of(SsResource.class, SsResourceVersion.class)) {
                var table = TableInfoHelper.getTableInfo(entity);
                List<String> columns = new ArrayList<>(List.of(table.getKeyColumn() + " BIGINT PRIMARY KEY"));
                table.getFieldList().stream().filter(field -> !newColumns.contains(field.getColumn())).forEach(field -> {
                    Class<?> type = field.getPropertyType();
                    String sqlType = Date.class.isAssignableFrom(type) ? "TIMESTAMP" : type == Boolean.class ? "BOOLEAN"
                        : Number.class.isAssignableFrom(type) ? "BIGINT" : "VARCHAR(20000)";
                    columns.add(field.getColumn() + " " + sqlType);
                });
                sql.execute("CREATE TABLE " + table.getTableName() + " (" + String.join(",", columns) + ")");
            }
            sql.execute("CREATE TABLE digital_employee_publication (request_id BIGINT PRIMARY KEY)");
            sql.execute("INSERT INTO ss_resource(resource_id, com_acct_id, resource_biz_type, resource_name, resource_r_verid, resource_d_verid) VALUES (10,1,'DIG_EMPLOYEE','原员工',0,1)");
            Path migration = Path.of("../deploy/migrations/versions/V0.5.2/V0.5.2__ddl.sql");
            String ddl = Files.readString(migration).replaceAll("(?m)^--.*$", "");
            for (String statement : ddl.split(";")) if (!statement.isBlank()) sql.execute(statement);
            var preserved = sql.executeQuery("SELECT resource_name FROM ss_resource WHERE resource_id=10");
            assertTrue(preserved.next()); assertEquals("原员工", preserved.getString(1));
        }
        session = new MybatisSqlSessionFactoryBuilder().build(config).openSession(false);
        session.getConnection().createStatement().execute("SET SCHEMA byai");
        resources = session.getMapper(SsResourceMapper.class);
        store = new EmployeeVersionStore();
        ReflectionTestUtils.setField(store, "resources", resources);
        ReflectionTestUtils.setField(store, "versions", session.getMapper(SsResourceVersionMapper.class));
        ReflectionTestUtils.setField(store, "relations", session.getMapper(EmployeeVersionRelationMapper.class));
        ReflectionTestUtils.setField(store, "activations", session.getMapper(EmployeeVersionActivationMapper.class));
        var sequence = mock(SequenceService.class); when(sequence.nextVal()).thenAnswer(call -> next++);
        ReflectionTestUtils.setField(store, "sequence", sequence);
        var employees = mock(DigitalEmployeeApplicationService.class);
        var current = new DigitalEmployeeDetailsDTO(); current.setResourceName("原员工"); current.setAgentType("001");
        when(employees.findDetailsById(any())).thenReturn(current); ReflectionTestUtils.setField(store, "employees", employees);
    }
    @AfterEach void close() { if (session != null) session.close(); }
    DigitalEmployeeDTO changed() {
        var config = new DigitalEmployeeDTO(); config.setAgentType("001"); config.setResourceName("新员工");
        config.setRelIds(List.of(42L)); config.setRelTools(List.of("weather")); return config;
    }
    @Test void draftDoesNotChangeActivePointerAndActivationDoesNotCreateDuplicateVersion() {
        var resource = resources.selectById(10L); store.baseline(resource);
        long baseline = resource.getResourceRVerid();
        var draft = store.append(resource, changed(), baseline, "EDIT_SAVED", "测试", "save-1", null);
        assertEquals(baseline, resources.selectById(10L).getResourceRVerid());
        assertEquals(draft.getResourceVersionId(), resources.selectById(10L).getResourceDVerid());
        var activation = store.activate(resource, draft, "activate-1", "回退");
        assertEquals(draft.getResourceVersionId(), resources.selectById(10L).getResourceRVerid());
        assertEquals(2, store.history(resource, 1, 20).size());
        assertEquals(activation.getActivationId(), store.activationRequest(resource, "activate-1").getActivationId());
        assertEquals(2, session.getMapper(EmployeeVersionRelationMapper.class).selectList(null).size());
        store.runtimeReady(resource); assertNull(resources.selectById(10L).getPendingActivationId());
    }
    @Test void successfulRetryClearsPersistedFailureWithoutChangingVersionHistory() {
        var resource = resources.selectById(10L); store.baseline(resource);
        var draft = store.append(resource, changed(), resource.getResourceRVerid(), "EDIT_SAVED", null, "save-1", null);
        var activation = store.activate(resource, draft, "activate-1", "生效");
        activation.setStatus("SYNC_FAILED"); activation.setErrorMessage("同步失败");
        var mapper = session.getMapper(EmployeeVersionActivationMapper.class);
        mapper.updateById(activation); session.commit();
        assertEquals("同步失败", mapper.selectById(activation.getActivationId()).getErrorMessage());
        store.runtimeReady(resources.selectById(10L)); session.commit();
        var completed = mapper.selectById(activation.getActivationId());
        assertEquals("READY", completed.getStatus()); assertNull(completed.getErrorMessage());
        assertNull(resources.selectById(10L).getPendingActivationId());
        assertEquals(2, store.history(resource, 1, 20).size());
    }
    @Test void staleCasRollsBackInsertedVersionAndKeepsLastCommittedConfiguration() {
        var resource = resources.selectById(10L); store.baseline(resource); session.commit();
        var stale = resources.selectById(10L);
        store.append(resource, changed(), resource.getResourceRVerid(), "EDIT_SAVED", null, "first", null); session.commit();
        assertThrows(RuntimeException.class, () -> store.append(stale, changed(), stale.getResourceRVerid(), "EDIT_SAVED", null, "second", null));
        session.rollback();
        assertEquals(2, store.history(resources.selectById(10L), 1, 20).size());
    }
    @Test void versionFromAnotherEmployeeOrTenantCannotBeRestored() {
        var resource = resources.selectById(10L); store.baseline(resource);
        long version = resource.getResourceRVerid();
        resource.setComAcctId(999L); assertThrows(RuntimeException.class, () -> store.requireVersion(resource, version));
        resource.setComAcctId(1L); resource.setResourceId(20L);
        assertThrows(RuntimeException.class, () -> store.requireVersion(resource, version));
    }
    @Test void employeeGroupInternalSnapshotCannotReplaceTheLatestSavedConfigurationPointer() {
        var resource = resources.selectById(10L); store.baseline(resource);
        long active = resource.getResourceRVerid();
        var draft = store.append(resource, changed(), active, "EDIT_SAVED", null, "group-save", null);
        var internal = resources.selectById(10L); internal.setResourceDVerid(777L); internal.setResourceRVerid(777L);
        resources.updateById(internal);
        try (var context = new EmployeeVersionContext(draft.getResourceVersionId(), "group-activate")) {
            store.recordCurrent(resource, changed(), "EDIT");
        }
        var stored = resources.selectById(10L);
        assertEquals(draft.getResourceVersionId(), stored.getResourceDVerid());
        assertEquals(draft.getResourceVersionId(), stored.getResourceRVerid());
        assertEquals(active, store.pending(stored).getFromVersionId());
        assertEquals(2, store.history(stored, 1, 20).size());
    }
}
