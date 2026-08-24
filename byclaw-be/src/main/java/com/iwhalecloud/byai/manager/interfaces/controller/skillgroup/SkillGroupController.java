package com.iwhalecloud.byai.manager.interfaces.controller.skillgroup;

import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.skillgroup.SkillGroupApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCreateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCandidatePageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupIdQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupInstallQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupMemberChangeQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupPageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUpdateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUninstallQo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupInstallResultVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberStatusSummaryVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupUninstallPreviewVo;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/skillGroup")
public class SkillGroupController {

    private final SkillGroupApplicationService skillGroupApplicationService;

    public SkillGroupController(SkillGroupApplicationService skillGroupApplicationService) {
        this.skillGroupApplicationService = skillGroupApplicationService;
    }

    @PostMapping("/create")
    @ManageLogAnnotation(name = "技能组", description = "创建技能组")
    public ResponseUtil<SkillGroupVo> create(@Valid @RequestBody SkillGroupCreateQo qo) {
        SkillGroupVo result = skillGroupApplicationService.create(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.create.success"), result);
    }

    @PostMapping("/update")
    @ManageLogAnnotation(name = "技能组", description = "更新技能组")
    public ResponseUtil<SkillGroupVo> update(@Valid @RequestBody SkillGroupUpdateQo qo) {
        SkillGroupVo result = skillGroupApplicationService.update(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.update.success"), result);
    }

    @PostMapping("/delete")
    @ManageLogAnnotation(name = "技能组", description = "删除技能组")
    public ResponseUtil<String> delete(@Valid @RequestBody SkillGroupIdQo qo) {
        skillGroupApplicationService.delete(qo);
        return ResponseUtil.success(I18nUtil.get("skillgroup.delete.success"));
    }

    @PostMapping("/page")
    public ResponseUtil<PageInfo<SkillGroupVo>> page(@Valid @RequestBody SkillGroupPageQo qo) {
        PageInfo<SkillGroupVo> result = skillGroupApplicationService.page(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.page.query.success"), result);
    }

    @PostMapping("/detail")
    public ResponseUtil<SkillGroupVo> detail(@Valid @RequestBody SkillGroupIdQo qo) {
        SkillGroupVo result = skillGroupApplicationService.detail(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.detail.query.success"), result);
    }

    @PostMapping("/member/candidates")
    public ResponseUtil<PageInfo<SkillGroupMemberVo>> pageMemberCandidates(
            @Valid @RequestBody SkillGroupCandidatePageQo qo) {
        PageInfo<SkillGroupMemberVo> result = skillGroupApplicationService.pageMemberCandidates(qo);
        return ResponseUtil.successResponse(
                I18nUtil.get("skillgroup.member.candidates.query.success"), result);
    }

    @PostMapping("/member/add")
    @ManageLogAnnotation(name = "技能组", description = "添加技能组成员")
    public ResponseUtil<String> addMembers(@Valid @RequestBody SkillGroupMemberChangeQo qo) {
        skillGroupApplicationService.addMembers(qo);
        return ResponseUtil.success(I18nUtil.get("skillgroup.member.add.success"));
    }

    @PostMapping("/member/remove")
    @ManageLogAnnotation(name = "技能组", description = "移除技能组成员")
    public ResponseUtil<String> removeMembers(@Valid @RequestBody SkillGroupMemberChangeQo qo) {
        skillGroupApplicationService.removeMembers(qo);
        return ResponseUtil.success(I18nUtil.get("skillgroup.member.remove.success"));
    }

    @PostMapping("/install")
    @ManageLogAnnotation(name = "技能组", description = "安装技能组")
    public ResponseUtil<SkillGroupInstallResultVo> install(@Valid @RequestBody SkillGroupInstallQo qo) {
        SkillGroupInstallResultVo result = skillGroupApplicationService.install(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.install.success"), result);
    }

    @PostMapping("/install/preflight")
    public ResponseUtil<SkillGroupMemberStatusSummaryVo> preflightInstall(
            @Valid @RequestBody SkillGroupInstallQo qo) {
        SkillGroupMemberStatusSummaryVo result = skillGroupApplicationService.preflightInstall(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.install.success"), result);
    }

    @PostMapping("/install/execute")
    @ManageLogAnnotation(name = "技能组", description = "确认安装技能组")
    public ResponseUtil<SkillGroupInstallResultVo> executeInstall(@Valid @RequestBody SkillGroupInstallQo qo) {
        SkillGroupInstallResultVo result = skillGroupApplicationService.executeInstall(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.install.success"), result);
    }

    @PostMapping("/uninstall")
    @ManageLogAnnotation(name = "技能组", description = "卸载技能组")
    public ResponseUtil<SkillGroupInstallResultVo> uninstall(@Valid @RequestBody SkillGroupUninstallQo qo) {
        SkillGroupInstallResultVo result = skillGroupApplicationService.uninstall(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.uninstall.success"), result);
    }

    @PostMapping("/uninstall/preflight")
    public ResponseUtil<SkillGroupUninstallPreviewVo> preflightUninstall(
            @Valid @RequestBody SkillGroupInstallQo qo) {
        SkillGroupUninstallPreviewVo result = skillGroupApplicationService.preflightUninstall(qo);
        return ResponseUtil.successResponse(I18nUtil.get("skillgroup.detail.query.success"), result);
    }
}
