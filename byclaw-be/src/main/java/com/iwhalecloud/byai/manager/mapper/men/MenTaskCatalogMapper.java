package com.iwhalecloud.byai.manager.mapper.men;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.men.MenTaskCatalog;
import org.apache.ibatis.annotations.Param;
import java.util.List;

public interface MenTaskCatalogMapper extends BaseMapper<MenTaskCatalog> {

    /**
     * 批量插入任务目录
     *
     * @param catalogs 任务目录列表
     * @return 影响行数
     */
    int batchInsert(@Param("list") List<MenTaskCatalog> catalogs);
}