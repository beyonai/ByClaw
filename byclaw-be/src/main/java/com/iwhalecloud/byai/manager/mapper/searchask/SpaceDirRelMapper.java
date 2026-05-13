package com.iwhalecloud.byai.manager.mapper.searchask;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDirRel;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 空间目录关联关系表 Mapper 接口，对应表：byai_space_dir_rel
 */
@Mapper
public interface SpaceDirRelMapper extends BaseMapper<SpaceDirRel> {

    /**
     * 批量插入目录关联记录
     *
     * @param list 关联记录列表
     * @return 插入行数
     */
    int insertBatch(@Param("list") List<SpaceDirRel> list);
}
