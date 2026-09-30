package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DigitalEmployeeGroupAuthorizationServiceTest {
    private final DigitalEmployeeGroupAuthorizationService service = new DigitalEmployeeGroupAuthorizationService();
    private final SsResExtDigEmployeeService employees = mock(SsResExtDigEmployeeService.class);
    private final SsResourceRelDetailService relations = mock(SsResourceRelDetailService.class);
    private final SsResourceMapper resources = mock(SsResourceMapper.class);
    private final PrivilegeGrantService grants = mock(PrivilegeGrantService.class);

    DigitalEmployeeGroupAuthorizationServiceTest() {
        ReflectionTestUtils.setField(service, "employeeService", employees);
        ReflectionTestUtils.setField(service, "relationService", relations);
        ReflectionTestUtils.setField(service, "resourceMapper", resources);
        ReflectionTestUtils.setField(service, "privilegeGrantService", grants);
    }

    @ParameterizedTest
    @ValueSource(strings = {GrantType.ALLOW_MANAGE, GrantType.FORCE_USE})
    void synchronizesBothListsAndRemovalsWithoutOverwritingOtherTargets(String grantType) {
        SsResource group = resource(1L, 10L);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType("017");
        when(employees.findById(1L)).thenReturn(ext);
        // 重复、自引用、跨企业、已删除和非数字员工关系均不应扩散授权。
        when(relations.list(any(LambdaQueryWrapper.class))).thenReturn(List.of(
            relation(2L), relation(2L), relation(1L), relation(3L), relation(4L), relation(5L), relation(6L)));
        when(resources.selectById(2L)).thenReturn(resource(2L, 10L));
        when(resources.selectById(3L)).thenReturn(resource(3L, 20L));
        SsResource skill = resource(5L, 10L);
        skill.setResourceBizType("SKILL");
        when(resources.selectById(5L)).thenReturn(skill);
        when(resources.selectById(6L)).thenReturn(resource(6L, 10L));
        when(grants.findPrivilegeGrant(grantType, "DIG_EMPLOYEE", 1L, Color.RED))
            .thenReturn(List.of(grant("USER", 100L, grantType)));
        when(grants.findPrivilegeGrant(grantType, "DIG_EMPLOYEE", 1L, Color.BLACK))
            .thenReturn(List.of(grant("ORG", 200L, grantType)));
        when(grants.findPrivilegeGrant(grantType, "DIG_EMPLOYEE", 2L, Color.RED))
            .thenReturn(List.of(grant("USER", 100L, grantType), grant("ORG", 100L, grantType)));
        when(grants.findPrivilegeGrant(grantType, "DIG_EMPLOYEE", 2L, Color.BLACK))
            .thenReturn(List.of(grant("ORG", 200L, grantType), grant("USER", 999L, grantType)));
        AuthRedBlackDTO input = authorization(grantType);
        input.setRedList(List.of(target("USER", 101L), target("USER", 101L)));
        input.setBlackList(List.of(target("ORG", 201L)));

        List<AuthRedBlackDTO> result = service.buildMemberAuthorizations(group, input);

        assertThat(result).extracting(AuthRedBlackDTO::getGrantObjId).containsExactly(2L, 6L);
        assertThat(result.get(0).getGrantType()).isEqualTo(grantType);
        assertThat(result.get(0).getRedList()).extracting(item -> item.getGrantToObjType() + item.getGrantToObjId())
            .containsExactly("ORG100", "USER101");
        assertThat(result.get(0).getBlackList()).extracting(item -> item.getGrantToObjType() + item.getGrantToObjId())
            .containsExactly("USER999", "ORG201");
        assertThat(result.get(1).getRedList()).extracting(AuthDTO::getGrantToObjId).containsExactly(101L);
        assertThat(input.getGrantObjId()).isEqualTo(1L);

        // 清空组授权也要撤销对应对象，但保留成员上其他对象的授权。
        input.setRedList(null);
        input.setBlackList(List.of());
        result = service.buildMemberAuthorizations(group, input);
        assertThat(result.get(0).getRedList()).extracting(AuthDTO::getGrantToObjType).containsExactly("ORG");
        assertThat(result.get(0).getBlackList()).extracting(AuthDTO::getGrantToObjId).containsExactly(999L);
    }

    @Test
    void ordinaryEmployeesAndOtherResourcesDoNotCascade() {
        SsResource resource = resource(1L, 10L);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType("001");
        when(employees.findById(1L)).thenReturn(ext);
        assertThat(service.buildMemberAuthorizations(resource, authorization(GrantType.FORCE_USE))).isEmpty();
        resource.setResourceBizType("SKILL");
        assertThat(service.buildMemberAuthorizations(resource, authorization(GrantType.ALLOW_MANAGE))).isEmpty();
        verifyNoInteractions(relations, resources, grants);
    }

    @Test
    void emptyGroupDoesNotChangeOtherResources() {
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType("017");
        when(employees.findById(1L)).thenReturn(ext);
        assertThat(service.buildMemberAuthorizations(resource(1L, 10L), authorization(GrantType.FORCE_USE))).isEmpty();
        verifyNoInteractions(resources, grants);
    }

    @ParameterizedTest
    @ValueSource(strings = {GrantType.ALLOW_MANAGE, GrantType.FORCE_USE})
    void groupAuthorizationIncludesDirectAndMemberSkills(String grantType) {
        SsResource group = resource(1L, 10L);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType("017");
        when(employees.findById(1L)).thenReturn(ext);
        when(relations.list(any(LambdaQueryWrapper.class))).thenReturn(List.of(relation(2L)));
        when(resources.selectById(2L)).thenReturn(resource(2L, 10L));
        SsResource directSkill = resource(7L, 10L);
        directSkill.setResourceBizType("SKILL");
        directSkill.setResourceStatus(2);
        SsResource memberSkill = resource(8L, 10L);
        memberSkill.setResourceBizType("SKILL");
        memberSkill.setResourceStatus(2);
        when(resources.selectById(7L)).thenReturn(directSkill);
        when(resources.selectById(8L)).thenReturn(memberSkill);
        when(relations.findByResourceId(1L)).thenReturn(List.of(relation(7L)));
        when(relations.findByResourceId(2L)).thenReturn(List.of(relation(7L), relation(8L)));
        when(grants.findPrivilegeGrant(grantType, "DIG_EMPLOYEE", 1L, Color.RED))
            .thenReturn(List.of(grant("ORG", 200L, grantType)));
        when(grants.findPrivilegeGrant(grantType, "SKILL", 7L, Color.RED))
            .thenReturn(List.of(grant("USER", 999L, grantType), grant("ORG", 200L, grantType)));
        AuthRedBlackDTO input = authorization(grantType);
        input.setRedList(List.of(target("ORG", 201L)));

        List<AuthRedBlackDTO> result = service.buildMemberAuthorizations(group, input);

        assertThat(result).extracting(AuthRedBlackDTO::getGrantObjId).containsExactly(2L, 7L, 8L);
        assertThat(result.get(1).getGrantObjType()).isEqualTo("SKILL");
        assertThat(result.get(1).getRedList()).extracting(AuthDTO::getGrantToObjId)
            .containsExactly(999L, 201L);
        assertThat(result.get(2).getGrantObjType()).isEqualTo("SKILL");
        assertThat(result.get(2).getRedList()).extracting(AuthDTO::getGrantToObjId).containsExactly(201L);

        input.setRedList(List.of());
        result = service.buildMemberAuthorizations(group, input);
        assertThat(result.get(1).getRedList()).extracting(AuthDTO::getGrantToObjId).containsExactly(999L);
    }

    private static AuthRedBlackDTO authorization(String type) {
        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantObjId(1L);
        dto.setGrantObjType("DIG_EMPLOYEE");
        dto.setGrantType(type);
        return dto;
    }

    private static SsResource resource(Long id, Long enterpriseId) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setComAcctId(enterpriseId);
        resource.setResourceBizType("DIG_EMPLOYEE");
        return resource;
    }

    private static SsResourceRelDetail relation(Long memberId) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setRelResourceId(memberId);
        return relation;
    }

    private static AuthDTO target(String type, Long id) {
        AuthDTO dto = new AuthDTO();
        dto.setGrantToObjType(type);
        dto.setGrantToObjId(id);
        return dto;
    }

    private static PrivilegeGrant grant(String type, Long id, String grantType) {
        PrivilegeGrant grant = new PrivilegeGrant();
        grant.setGrantToObjType(type);
        grant.setGrantToObjId(id);
        grant.setGrantType(grantType);
        return grant;
    }
}
