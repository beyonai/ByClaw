package com.iwhalecloud.byai.manager.application.service.openapi;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.position.PositionExternal;
import com.iwhalecloud.byai.manager.domain.position.service.PositionExternalService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPositionDTO;
import com.iwhalecloud.byai.manager.dto.position.PositionDelDTO;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-31 23:07:47
 * @description TODO
 */
@Service
public class OpenPositionApplicationService {

    @Autowired
    private PositionService positionService;

    @Autowired
    private PositionExternalService positionExternalService;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 新增岗位
     *
     * @param openPositionDTO 查询
     * @return 岗位主键
     */
    public Long addPosition(OpenPositionDTO openPositionDTO) {

        Position position = new Position();
        // 是否使用新生成的主键记录
        if (openPositionDTO.isNewPrimaryKey()) {
            position.setPositionId(SequenceService.nextVal());
        }
        else {
            position.setPositionId(openPositionDTO.getPositionId());
        }

        position.setPositionName(openPositionDTO.getPositionName());
        position.setPositionDesc(openPositionDTO.getPositionDesc());
        positionService.save(position);

        PositionExternal positionExternal = new PositionExternal();
        BeanUtils.copyProperties(openPositionDTO, positionExternal);
        positionExternal.setPositionExternalId(SequenceService.nextVal());
        positionExternal.setUnionId(openPositionDTO.getPositionId() + "");
        positionExternal.setPositionId(position.getPositionId());
        positionExternal.setSourceType(SourceType.LOCAL);
        positionExternalService.save(positionExternal);

        // 同步redis
        ShareCacheUtil.setSharePosition(position);

        return position.getPositionId();
    }

    /**
     * 修改岗位
     *
     * @param openPositionDTO 查询
     * @return 岗位主键
     */
    public Long updatePosition(OpenPositionDTO openPositionDTO) {
        Long sourcePositionId = openPositionDTO.getPositionId();

        // 修改扩展表信息
        PositionExternal positionExternal = positionExternalService.findByUnionId(sourcePositionId + "");
        positionExternal.setPositionName(openPositionDTO.getPositionName());
        positionExternal.setPositionDesc(openPositionDTO.getPositionDesc());
        positionExternalService.update(positionExternal);

        // 修改外系统信息
        Position position = positionService.findById(positionExternal.getPositionId());
        position.setPositionName(openPositionDTO.getPositionName());
        position.setPositionDesc(openPositionDTO.getPositionDesc());
        positionService.update(position);

        // 同步redis
        ShareCacheUtil.setSharePosition(position);

        return position.getPositionId();
    }

    /**
     * 移除岗位
     *
     * @param positionDelDTO 删除参数
     */
    public void removePosition(PositionDelDTO positionDelDTO) {

        Long sourcePositionId = positionDelDTO.getPositionId();
        PositionExternal positionExternal = positionExternalService.findByUnionId(sourcePositionId + "");
        positionExternalService.deleteById(positionExternal.getPositionExternalId());

        // 删除关联岗位
        positionService.deleteById(positionExternal.getPositionId());
    }

    /**
     * 查询岗位
     * 
     * @param qo 查询对象
     * @return PageInfo
     */
    public PageInfo<Position> listPosition(QueryObject qo) {

        LambdaQueryWrapper<Position> queryWrapper = new LambdaQueryWrapper<>();
        if (StringUtil.isNotEmpty(qo.getKeyword())) {
            queryWrapper.like(Position::getPositionName, qo.getKeyword());
        }

        Page<Position> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);
        List<Position> positions = positionService.selectList(page, queryWrapper);
        page.setRecords(positions);
        return PageHelperUtil.toPageInfo(page);
    }
}
