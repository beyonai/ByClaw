package com.iwhalecloud.byai.manager.application.service.position;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.mapper.position.PositionMapper;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.qo.position.PositionQo;
import com.iwhalecloud.byai.manager.qo.position.PositionUsersQo;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.vo.position.PositionUsersVo;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.dto.position.PositionDelDTO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 岗位应用服务
 */
@Service
public class PositionApplicationService {

    @Autowired
    private PositionMapper positionMapper;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private PositionService positionService;

    /**
     * 查询岗位列表
     *
     * @param positionQo 入参
     * @return ResponseUtil
     */
    public PageInfo<Position> searchPositionList(PositionQo positionQo) {
        Page<Position> page = new Page<>(positionQo.getPageNum(), positionQo.getPageSize());
        List<Position> records = positionMapper.searchPositionList(page, positionQo);
        page.setRecords(records);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询岗位下面的用户列表
     *
     * @param positionUsersQo 查询对象
     * @return ResponseUtil
     */
    public PageInfo<PositionUsersVo> searchPositionUsersByQo(PositionUsersQo positionUsersQo) {

        Page<PositionUsersVo> page = new Page<>(positionUsersQo.getPageNum(), positionUsersQo.getPageSize());
        positionMapper.searchPositionUsersByQo(page, positionUsersQo);

        // 设置组织路径,一个用户对应多个组织
        List<PositionUsersVo> records = page.getRecords();

        for (int i = 0; records != null && i < records.size(); i++) {
            PositionUsersVo positionUsersVo = records.get(i);
            String orgIdStr = positionUsersVo.getOrgIds();
            positionUsersVo.setPhone(UserApplicationService.decryptAndMaskPhone(positionUsersVo.getPhone()));
            List<Long> orgIds = new ArrayList<>();
            for (String orgId : orgIdStr.split(",")) {
                orgIds.add(Long.parseLong(orgId));
            }
            String pathName = organizationService.buildPathNameByOrgIds(orgIds);
            positionUsersVo.setPathName(pathName);
        }
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 添加岗位
     *
     * @param position 岗位
     * @return ResponseUtil
     */
    public ResponseUtil addPosition(Position position) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.add.nopermission"));
        }

        position.setIsDigitalPosition(0);
        positionService.addPosition(position);

        // 同步redis
        ShareCacheUtil.setSharePosition(position);

        return ResponseUtil.successResponse(I18nUtil.get("position.add.success"), position);

    }

    /**
     * 修改岗位
     *
     * @param position 岗位
     * @return ResponseUtil
     */
    public ResponseUtil updatePosition(Position position) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.update.nopermission"));
        }

        positionService.updatePosition(position);

        // 同步redis
        ShareCacheUtil.setSharePosition(position);

        return ResponseUtil.successResponse(I18nUtil.get("position.modify.success"), position);

    }

    /***
     * 移除岗位
     *
     * @param positionDelDTO 岗位删除
     * @return ResponseUtil
     */
    public ResponseUtil removePosition(PositionDelDTO positionDelDTO) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.delete.nopermission"));
        }
        positionService.removePosition(positionDelDTO.getPositionId());
        return ResponseUtil.success(I18nUtil.get("position.delete.success"));

    }
}
