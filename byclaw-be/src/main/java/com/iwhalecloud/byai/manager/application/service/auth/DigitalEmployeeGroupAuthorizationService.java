package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** 根据员工组授权前后的名单，为当前组员生成对应授权，复用统一授权写入与缓存链路。 */
@Service
public class DigitalEmployeeGroupAuthorizationService {

    @Autowired
    private SsResExtDigEmployeeService employeeService;

    @Autowired
    private SsResourceRelDetailService relationService;

    @Autowired
    private SsResourceMapper resourceMapper;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    public List<AuthRedBlackDTO> buildMemberAuthorizations(SsResource group, AuthRedBlackDTO authorization) {
        if (!ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(group.getResourceBizType())) {
            return Collections.emptyList();
        }
        SsResExtDigEmployee ext = employeeService.findById(group.getResourceId());
        if (ext == null || !DigitalEmployeeGroupApplicationService.GROUP_AGENT_TYPE.equals(ext.getAgentType())) {
            return Collections.emptyList();
        }
        List<Long> memberIds = relationService.list(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, group.getResourceId())
            .eq(SsResourceRelDetail::getRelTypeName, DigitalEmployeeGroupApplicationService.GROUP_MEMBER_REL_TYPE)
            .eq(SsResourceRelDetail::getRelStatus, 1))
            .stream().map(SsResourceRelDetail::getRelResourceId).filter(Objects::nonNull)
            .filter(id -> !id.equals(group.getResourceId())).distinct().collect(Collectors.toList());
        if (memberIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<PrivilegeGrant> oldRed = grants(authorization, group.getResourceId(), Color.RED);
        List<PrivilegeGrant> oldBlack = grants(authorization, group.getResourceId(), Color.BLACK);
        List<AuthRedBlackDTO> result = new ArrayList<>();
        for (Long memberId : memberIds) {
            SsResource member = resourceMapper.selectById(memberId);
            // 只同步当前企业内真实的数字员工，忽略失效或跨企业的脏关联。
            if (member == null || !Objects.equals(group.getComAcctId(), member.getComAcctId())
                || !ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(member.getResourceBizType())) {
                continue;
            }
            AuthRedBlackDTO memberAuth = new AuthRedBlackDTO();
            BeanUtils.copyProperties(authorization, memberAuth);
            memberAuth.setGrantObjId(memberId);
            memberAuth.setRedList(mergeTargets(grants(authorization, memberId, Color.RED), oldRed,
                authorization.getRedList()));
            memberAuth.setBlackList(mergeTargets(grants(authorization, memberId, Color.BLACK), oldBlack,
                authorization.getBlackList()));
            result.add(memberAuth);
        }
        return result;
    }

    private List<PrivilegeGrant> grants(AuthRedBlackDTO authorization, Long resourceId, String color) {
        return privilegeGrantService.findPrivilegeGrant(authorization.getGrantType(), authorization.getGrantObjType(),
            resourceId, color);
    }

    /** 移除组原名单中的对象后应用新名单；其他对象保持不变，人员与组织等维度分别去重。 */
    static List<AuthDTO> mergeTargets(List<PrivilegeGrant> existing, List<PrivilegeGrant> previous,
        List<AuthDTO> requested) {
        Map<String, AuthDTO> targets = new LinkedHashMap<>();
        for (PrivilegeGrant grant : existing) {
            AuthDTO target = new AuthDTO();
            target.setGrantToObjType(grant.getGrantToObjType());
            target.setGrantToObjId(grant.getGrantToObjId());
            target.setGrantType(grant.getGrantType());
            targets.put(key(target.getGrantToObjType(), target.getGrantToObjId()), target);
        }
        for (PrivilegeGrant grant : previous) {
            targets.remove(key(grant.getGrantToObjType(), grant.getGrantToObjId()));
        }
        if (requested != null) {
            for (AuthDTO target : requested) {
                targets.put(key(target.getGrantToObjType(), target.getGrantToObjId()), target);
            }
        }
        return new ArrayList<>(targets.values());
    }

    private static String key(String type, Long id) {
        return type + ":" + id;
    }
}
