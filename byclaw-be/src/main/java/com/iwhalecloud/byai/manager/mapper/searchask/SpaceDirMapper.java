package com.iwhalecloud.byai.manager.mapper.searchask;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDir;
import com.iwhalecloud.byai.manager.qo.searchask.CollectResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.EnterpriseKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.PersonalKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SelectedKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SkillResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.SpaceResourceQo;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceKbResourceVo;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceResourceVo;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 空间目录表 Mapper 接口，对应表：byai_space_dir
 */
@Mapper
public interface SpaceDirMapper extends BaseMapper<SpaceDir> {

    /**
     * 查询导入对象
     *
     * @param importResourceQo 查询
     * @return ResponseUtil
     */
    List<SpaceResourceVo> listImportResource(SpaceResourceQo importResourceQo);

    /**
     * 查询收藏夹内容，查询当前用户的
     *
     * @param collectResourceQo 查询对象
     * @return SpaceResourceVo
     */
    List<SpaceResourceVo> listCollectResource(CollectResourceQo collectResourceQo);

    /**
     * 批量插入空间目录
     *
     * @param list 空间目录列表
     * @return 插入行数
     */
    int insertBatch(@Param("list") List<SpaceDir> list);

    /**
     * 查询技能
     *
     * @param skillResourceQo 查询对象
     * @return List
     */
    List<SpaceResourceVo> listSkills(SkillResourceQo skillResourceQo);

    /**
     * 查询已经选择的
     * 
     * @param selectedKbQo 查询对象
     * @return List<SpaceResourceVo>
     */
    List<SpaceKbResourceVo> listSelectedKb(SelectedKbQo selectedKbQo);

    /**
     * 个人知识库
     *
     * @param personalKbQo 查询对象
     * @return List<SpaceResourceVo>
     */
    List<SpaceKbResourceVo> listPersonalKb(PersonalKbQo personalKbQo);

    /**
     * 查询企业知识库
     * 
     * @param enterpriseKbQo 查询对象
     * @return List<SpaceResourceVo>
     */
    List<SpaceKbResourceVo> listEnterpriseKb(EnterpriseKbQo enterpriseKbQo);
}
