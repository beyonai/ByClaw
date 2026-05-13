package com.iwhalecloud.byai.manager.domain.position.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.mapper.position.PositionMapper;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.dto.position.PositionDTO;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;

import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

/**
 * 岗位服务接口
 */
@Service
public class PositionService {

    private static final Logger logger = LoggerFactory.getLogger(PositionService.class);

    @Autowired
    private PositionMapper positionMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 新增岗位
     *
     * @param position 查询
     */
    public void addPosition(Position position) {

        Long count = positionMapper.countPosition(position.getPositionName(), null);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.name.duplicate"));
        }

        position.setPositionId(SequenceService.nextVal());

        positionMapper.insert(position);
    }

    /**
     * 修改岗位
     *
     * @param position 查询
     */
    public void updatePosition(Position position) {

        Long count = positionMapper.countPosition(position.getPositionName(), position.getPositionId());
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.name.duplicate"));
        }

        Position updatePosition = positionMapper.selectById(position.getPositionId());
        if (updatePosition == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.not.exist"));
        }

        // 设置
        updatePosition.setPositionName(position.getPositionName());
        updatePosition.setPositionDesc(position.getPositionDesc());
        positionMapper.updateById(updatePosition);

    }

    /**
     * 移除岗位
     *
     * @param positionId 查询
     */
    public void removePosition(Long positionId) {

        Long count = positionMapper.countUsed(positionId);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.has.user"));
        }
        positionMapper.deleteById(positionId);
    }

    /**
     * 查询岗位
     *
     * @param positionId 标识
     * @return Position
     */
    public Position findById(Long positionId) {
        return positionMapper.selectById(positionId);
    }

    /**
     * 查询用户的岗位信�?
     *
     * @param userId 用户标识
     * @return List
     */
    public List<PositionDTO> findPositionByUserId(Long userId) {
        return positionMapper.findPositionByUserId(userId);
    }

    /**
     * 简单列表查询
     *
     * @param page 分页参数
     * @param queryWrapper 查询对象
     * @return Position
     */
    public List<Position> selectList(IPage<Position> page, Wrapper<Position> queryWrapper) {
        return positionMapper.selectList(page, queryWrapper);
    }

    /**
     * 保存岗位
     *
     * @param position 岗位信息
     */
    public void save(Position position) {
        positionMapper.insert(position);
    }

    /**
     * 修改岗位
     *
     * @param position 岗位信息
     */
    public void update(Position position) {
        positionMapper.updateById(position);
    }

    /**
     * 删除岗位
     *
     * @param positionId 岗位标识
     */
    public void deleteById(Long positionId) {
        positionMapper.deleteById(positionId);
    }

    /**
     * 优先从缓存中查询组织信息
     *
     * @param positionId 组织标识
     * @return String
     */
    public String getCachePositionName(Long positionId) {

        Position position = ShareCacheUtil.getSharePosition(positionId);

        if (position != null) {
            return position.getPositionName();
        }
        position = this.findFirstById(positionId);

        return position != null ? position.getPositionName() : null;
    }

    private Position findFirstById(Long positionId) {
        if (positionId == null) {
            return null;
        }
        List<Position> positions = positionMapper.selectList(
            new LambdaQueryWrapper<Position>().eq(Position::getPositionId, positionId));
        if (positions == null || positions.isEmpty()) {
            return null;
        }
        if (positions.size() > 1) {
            logger.warn("Found duplicate position records, positionId={}, count={}", positionId, positions.size());
        }
        return positions.get(0);
    }

    /**
     * 判断是否为数字岗位
     */
    public Position isDigitalPosition(Long positionId) {
        if (positionId == null) {
            return null;
        }
        LambdaQueryWrapper<Position> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Position::getPositionId, positionId);
        wrapper.eq(Position::getIsDigitalPosition, 1);
        Position position = positionMapper.selectOne(wrapper);
        if (position == null) {
            return null;
        }
        return position;
    }

}
