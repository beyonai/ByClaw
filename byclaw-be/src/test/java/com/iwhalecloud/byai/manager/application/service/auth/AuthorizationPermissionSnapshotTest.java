package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.AuthorizationSubjectMapper;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import java.util.*;
import java.util.stream.LongStream;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AuthorizationPermissionSnapshotTest {
    @Test void batches3000UsersAnd15ResourcesWhilePreservingInheritedSubjectsAndBlacklists() {
        var source = new UnpooledDataSource("org.h2.Driver", "jdbc:h2:mem:snapshot_"+UUID.randomUUID()+";DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE po_users (user_id bigint, station_id bigint)");
        jdbc.execute("CREATE TABLE po_users_organization (user_id bigint, org_id bigint, position_id bigint)");
        jdbc.execute("CREATE TABLE po_organization (org_id bigint, path_code varchar(100))");
        jdbc.execute("CREATE TABLE po_station (station_id bigint, station_id_path varchar(100))");
        jdbc.execute("CREATE TABLE po_position (position_id bigint, is_digital_position int)");
        jdbc.execute("INSERT INTO po_organization VALUES (2,'1.2')");
        jdbc.execute("INSERT INTO po_station VALUES (22,'21.22')");
        jdbc.execute("INSERT INTO po_position VALUES (5,0),(6,1)");
        jdbc.batchUpdate("INSERT INTO po_users VALUES (?,22)", LongStream.rangeClosed(1,3000).mapToObj(id->new Object[]{id}).toList());
        jdbc.batchUpdate("INSERT INTO po_users_organization VALUES (?,2,5)", LongStream.rangeClosed(1,3000).mapToObj(id->new Object[]{id}).toList());
        jdbc.execute("INSERT INTO po_users_organization VALUES (1,2,6)");
        var config = new MybatisConfiguration(new Environment("test",new SpringManagedTransactionFactory(),source));
        config.setMapUnderscoreToCamelCase(true);config.addMapper(AuthorizationSubjectMapper.class);
        var memberships = spy(new SqlSessionTemplate(new MybatisSqlSessionFactoryBuilder().build(config)).getMapper(AuthorizationSubjectMapper.class));
        var mapper = mock(PrivilegeGrantMapper.class);
        // Include the mapper entity metadata used by the actual query wrapper.
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(new org.apache.ibatis.builder.MapperBuilderAssistant(config,""), PrivilegeGrant.class);
        List<PrivilegeGrant> records = new ArrayList<>();
        List<SsResource> resources = new ArrayList<>();
        for(long id=100;id<115;id++) {
            SsResource resource = new SsResource();resource.setResourceId(id);resource.setResourceBizType("SKILL");resources.add(resource);
            records.add(grant(id,"ORG",1L,"RED"));
            records.add(grant(id,"POST",5L,"BLACK"));
            records.add(grant(id,"STATION",21L,"RED"));
            records.add(grant(id,"POST",6L,"RED"));
        }
        when(mapper.selectList(any())).thenReturn(records);
        long start = System.nanoTime();
        try(var snapshot = new AuthorizationPermissionSnapshot(resources,LongStream.rangeClosed(1,3000).boxed().toList(),memberships,mapper)) {
            int checks=0;
            for(SsResource resource: resources) for(long user=1;user<=3000;user++) {
                List<PrivilegeGrant> grants=AuthorizationPermissionSnapshot.find(resource,user,List.of("FORCE_USE"));
                assertThat(grants).hasSize(3);
                assertThat(grants).extracting(PrivilegeGrant::getGrantToType).contains("BLACK");
                checks++;
            }
            assertThat(checks).isEqualTo(45000);
        }
        verify(memberships,times(6)).memberships(anyList());
        verify(mapper,times(1)).selectList(any());
        assertThat(AuthorizationPermissionSnapshot.find(resources.get(0),1L,List.of("FORCE_USE"))).isNull();
        System.out.println("AUTH_BENCH pairs=45000 membershipQueries=6 grantQueries=1 elapsedMs="+(System.nanoTime()-start)/1_000_000);
    }
    @Test void userCacheRebuildReusesAllGrantFamiliesWithoutDroppingOrganizationOrPostInheritance() {
        var memberships = mock(AuthorizationSubjectMapper.class);
        var row = new com.iwhalecloud.byai.manager.dto.auth.AuthorizationSubject();
        row.setUserId(1L); row.setSubjectType("ORG"); row.setSubjectId(2L); row.setSubjectPath("1.2");
        when(memberships.memberships(anyList())).thenReturn(List.of(row));
        var mapper = mock(PrivilegeGrantMapper.class);
        var config = new MybatisConfiguration();
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(new org.apache.ibatis.builder.MapperBuilderAssistant(config,""), PrivilegeGrant.class);
        PrivilegeGrant direct = grant(100,"USER",1,"RED");
        PrivilegeGrant inherited = grant(101,"ORG",1,"BLACK"); inherited.setGrantType("ALLOW_MANAGE");
        when(mapper.selectList(any())).thenAnswer(call -> {
            var query = (com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<PrivilegeGrant>) call.getArgument(0);
            query.getSqlSegment();
            return query.getParamNameValuePairs().containsValue("USER") ? List.of(direct) : List.of(inherited);
        });
        try (var snapshot = new AuthorizationPermissionSnapshot(null,List.of(1L),memberships,mapper)) {
            assertThat(AuthorizationPermissionSnapshot.findAll(1L,null,List.of("FORCE_USE"),null)).containsExactly(direct);
            assertThat(AuthorizationPermissionSnapshot.findAll(1L,"ALLOW_MANAGE",null,null)).containsExactly(inherited);
            assertThat(AuthorizationPermissionSnapshot.findAll(1L,"ALLOW_MANAGE",null,List.of("KG_DOC"))).isEmpty();
            assertThat(AuthorizationPermissionSnapshot.findAll(999L,null,null,null)).isNull();
        }
        verify(mapper,times(2)).selectList(any());
    }

    private PrivilegeGrant grant(long resource,String type,long subject,String color) {
        PrivilegeGrant grant=new PrivilegeGrant();grant.setGrantObjId(resource);grant.setGrantObjType("SKILL");
        grant.setGrantToObjType(type);grant.setGrantToObjId(subject);grant.setGrantType("FORCE_USE");grant.setGrantToType(color);return grant;
    }
}
