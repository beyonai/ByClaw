package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.HashMap;
import java.util.Map;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.*;

/** Opt-in real PostgreSQL check of annotation SQL and transaction rollback; each run owns its schema. */
class HumanTaskMapperPostgresTest {
    @Test void mapperPersistsIdsAndFencesTaskAndUploadRevisions() throws Exception {
        String url=System.getenv("HUMAN_TASK_TEST_JDBC_URL");
        assumeTrue(url!=null,"HUMAN_TASK_TEST_JDBC_URL not configured");
        String user=System.getenv().getOrDefault("HUMAN_TASK_TEST_DB_USER",System.getProperty("user.name"));
        String schema="human_task_it_"+System.nanoTime();
        String jar=System.getenv("HUMAN_TASK_PG_DRIVER_JAR");
        assumeTrue(jar!=null,"HUMAN_TASK_PG_DRIVER_JAR avoids the bundled openGauss driver shadowing PostgreSQL classes");
        try(var loader=new java.net.URLClassLoader(new java.net.URL[]{Path.of(jar).toUri().toURL()},ClassLoader.getPlatformClassLoader())) {
        var driver=(java.sql.Driver)Class.forName("org.postgresql.Driver",true,loader).getConstructor().newInstance();
        java.util.Properties properties=new java.util.Properties();properties.setProperty("user",user);
        try(var connection=driver.connect(url,properties)) {
            try(var statement=connection.createStatement()) {
                statement.execute("CREATE SCHEMA "+schema);
                Path migration=Path.of("../deploy/migrations/versions/V0.7.0/V0.7.0__ddl.sql");
                if(!Files.exists(migration))migration=Path.of("deploy/migrations/versions/V0.7.0/V0.7.0__ddl.sql");
                String text=Files.readString(migration);
                text=text.substring(text.indexOf("-- 真人待办独立生命周期"));
                for(String sql:text.replace("byai.",schema+".").split(";"))if(!sql.isBlank())statement.execute(sql);
            }
            try {
                String scoped=url+(url.contains("?")?"&":"?")+"currentSchema="+schema;
                javax.sql.DataSource ds=new javax.sql.DataSource() {
                    public java.sql.Connection getConnection() throws java.sql.SQLException {return driver.connect(scoped,properties);}
                    public java.sql.Connection getConnection(String u,String p) throws java.sql.SQLException {return getConnection();}
                    public java.io.PrintWriter getLogWriter(){return null;}
                    public void setLogWriter(java.io.PrintWriter writer){}
                    public void setLoginTimeout(int seconds){}
                    public int getLoginTimeout(){return 0;}
                    public java.util.logging.Logger getParentLogger(){return java.util.logging.Logger.getGlobal();}
                    public boolean isWrapperFor(Class<?> type){return false;}
                    public <T>T unwrap(Class<T> type) throws java.sql.SQLException {throw new java.sql.SQLException("not a wrapper");}
                };
                Configuration configuration=new Configuration(new Environment("human-task-test",new JdbcTransactionFactory(),ds));
                configuration.addMapper(GroupHumanTaskMapper.class);
                var factory=new SqlSessionFactoryBuilder().build(configuration);
                try(var session=factory.openSession(false)) {
                    var db=session.getMapper(GroupHumanTaskMapper.class);
                    Map<String,Object> row=new HashMap<>();
                    row.put("tenant",10L);row.put("id",100L);row.put("group",30L);row.put("actor",20L);row.put("source",40L);
                    row.put("senderType","USER");row.put("senderId",20L);
                    row.put("request","create");row.put("hash","a".repeat(64));row.put("status","DRAFT");row.put("revision",0L);row.put("payload","{\"batchId\":\"100\"}");
                    assertEquals(1,db.insertBatch(row));assertEquals(row.get("payload"),db.batch(10L,100L).get("payload"));assertNull(db.batch(11L,100L));
                    assertEquals("USER",db.batch(10L,100L).get("senderType"));assertEquals(20L,db.batch(10L,100L).get("senderId"));
                    row.put("id",200L);row.put("batch",100L);row.put("assignee",21L);row.put("version",0);row.put("payload","{\"humanTaskId\":\"200\"}");row.put("status","PENDING");
                    assertEquals(1,db.insertTask(row));row.put("expected",0L);row.put("revision",1L);
                    assertEquals(1,db.updateTask(row));assertEquals(0,db.updateTask(row));
                    assertEquals(1,db.bind(Map.of("session",300L,"tenant",10L,"task",200L,"type","PRIVATE")));
                    assertEquals(200L,((Number)db.binding(10L,300L).get("humanTaskId")).longValue());
                    row.put("request","upload");row.put("payload","{\"status\":\"UPLOADING\"}");
                    assertEquals(1,db.insertRequest(row));row.put("expected",0L);
                    assertEquals(1,db.checkpointRequest(row));assertEquals(0,db.checkpointRequest(row));
                    assertEquals(1L,((Number)db.requestState(200L,"upload").get("revision")).longValue());
                    row.put("status","ACCEPTED");row.put("expected",1L);row.put("revision",2L);
                    assertEquals(1,db.updateTask(row));row.put("expected",2L);row.put("revision",3L);assertEquals(0,db.updateTask(row));
                    session.rollback();assertNull(db.task(10L,200L));
                }
            } finally {
                try(var statement=connection.createStatement()){statement.execute("DROP SCHEMA "+schema+" CASCADE");}
            }
        }
        }
    }
}
