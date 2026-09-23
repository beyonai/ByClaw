package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.manager.dto.resource.SsResExtSkillDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSkillMapper;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONException;
import com.alibaba.fastjson.JSONObject;
import java.util.HashSet;
import java.util.Set;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 技能资源扩展服务
 *
 * @author qin.guoquan
 * @date 2026-06-18 19:38:38
 */
@Service
public class SsResExtSkillService {

    public static final String DEFAULT_SKILL_TYPE = "hub";

    public static final String INNER_SKILL_TYPE = "inner";

    public static final String DEFAULT_VERSION = "v0.1";

    public static final String DEFAULT_PACKAGE_FORMAT = "zip";

    private static final Pattern VERSION_PATTERN = Pattern.compile("^v(\\d+)\\.(\\d+)$");

    @Autowired
    private SsResExtSkillMapper ssResExtSkillMapper;

    /**
     * 插入技能扩展数据
     *
     * @param ssResExtSkill 技能扩展数据
     */
    public void save(SsResExtSkill ssResExtSkill) {
        fillDefaults(ssResExtSkill);
        ssResExtSkillMapper.insert(ssResExtSkill);
    }

    /**
     * 更新技能扩展数据
     *
     * @param ssResExtSkill 技能扩展数据
     */
    public void update(SsResExtSkill ssResExtSkill) {
        ssResExtSkillMapper.updateById(ssResExtSkill);
    }

    /**
     * 保存或更新技能扩展数据
     *
     * @param ssResExtSkill 技能扩展数据
     */
    public void saveOrUpdate(SsResExtSkill ssResExtSkill) {
        if (ssResExtSkill == null || ssResExtSkill.getResourceId() == null) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.resource.id.empty"));
        }
        fillDefaults(ssResExtSkill);
        if (ssResExtSkillMapper.selectById(ssResExtSkill.getResourceId()) == null) {
            ssResExtSkillMapper.insert(ssResExtSkill);
        }
        else {
            ssResExtSkillMapper.updateById(ssResExtSkill);
        }
    }

    /**
     * 删除技能扩展数据
     *
     * @param resourceId 资源ID
     */
    public void removeById(Long resourceId) {
        ssResExtSkillMapper.deleteById(resourceId);
    }

    /**
     * 根据资源ID查询技能扩展数据
     *
     * @param resourceId 资源ID
     * @return 技能扩展数据
     */
    public SsResExtSkill findById(Long resourceId) {
        return ssResExtSkillMapper.selectById(resourceId);
    }

    /**
     * PR-3 (#150) 批量查询技能扩展数据. 单 SQL IN 子句,替代循环 findById.
     *
     * @param resourceIds 资源ID集合(空集合/null 时返回空 List,不触发 SQL)
     * @return 技能扩展列表
     */
    public List<SsResExtSkill> findByIds(Collection<Long> resourceIds) {
        return ssResExtSkillMapper.findByIds(resourceIds);
    }

    /** 按来源标记确认企业副本，避免同编码的手工导入技能影响按钮。空列表不查询数据库。 */
    public Set<Long> findSourceIdsWithEnterpriseCopies(Collection<Long> sourceIds) {
        if (sourceIds == null || sourceIds.isEmpty()) {
            return Collections.emptySet();
        }
        Set<Long> result = new HashSet<>();
        for (SsResExtSkill copy : ssResExtSkillMapper.findExistingEnterpriseCopies(sourceIds)) {
            if (!StringUtils.hasText(copy.getTargetContent())) {
                continue;
            }
            try {
                JSONObject content = JSON.parseObject(copy.getTargetContent());
                Long sourceId = content == null ? null : content.getLong("sourceResourceId");
                if (sourceId != null && sourceIds.contains(sourceId)) {
                    result.add(sourceId);
                }
            }
            catch (JSONException | IllegalArgumentException ignored) {
                // 历史非 JSON 内容或无效来源 ID 不构成可识别的企业副本。
            }
        }
        return result;
    }

    /**
     * 查询技能版本号
     *
     * @param resourceId 资源ID
     * @return 技能版本号
     */
    public String findVersionById(Long resourceId) {
        SsResExtSkill extSkill = findById(resourceId);
        return extSkill == null ? null : extSkill.getVersion();
    }

    /**
     * 将版本号递增一个小版本：v0.1 -> v0.2。
     *
     * @param currentVersion 当前版本号
     * @return 下一个版本号
     */
    public String nextVersion(String currentVersion) {
        if (!StringUtils.hasText(currentVersion)) {
            return DEFAULT_VERSION;
        }
        Matcher matcher = VERSION_PATTERN.matcher(currentVersion.trim());
        if (!matcher.matches()) {
            return DEFAULT_VERSION;
        }
        int major = Integer.parseInt(matcher.group(1));
        int minor = Integer.parseInt(matcher.group(2));
        return "v" + major + "." + (minor + 1);
    }

    private void fillDefaults(SsResExtSkill ssResExtSkill) {
        if (ssResExtSkill == null) {
            throw new IllegalArgumentException("技能扩展数据不能为空");
        }
        if (!StringUtils.hasText(ssResExtSkill.getSkillType())) {
            ssResExtSkill.setSkillType(DEFAULT_SKILL_TYPE);
        }
        if (!StringUtils.hasText(ssResExtSkill.getVersion())) {
            ssResExtSkill.setVersion(DEFAULT_VERSION);
        }
        if (!StringUtils.hasText(ssResExtSkill.getSkillPackageFormat())) {
            ssResExtSkill.setSkillPackageFormat(DEFAULT_PACKAGE_FORMAT);
        }
    }

    /**
     * 根据编码查询技能信息
     *
     * @param skillCodes 资源标识
     * @return List<ResourceExtDigEmployeeDto>
     */
    public List<SsResExtSkillDto> findBySkillCodes(Collection<String> skillCodes) {
        if (ListUtil.isEmpty(skillCodes)) {
            return Collections.emptyList();
        }
        return ssResExtSkillMapper.findBySkillCodes(skillCodes);
    }

}
