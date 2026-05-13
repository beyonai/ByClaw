package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDownloadResult;

/**
 * 成果空间策略接口
 *
 * <p>不同类型的成果空间在存储、详情展示、下载等方面存在差异，
 * 通过策略模式解耦具体实现，便于扩展。</p>
 */
public interface ShowcaseStrategy {

    /**
     * 获取策略支持的成果类型
     *
     * @return 类型
     */
    String getType();

    /**
     * 保存前的预处理逻辑
     *
     * @param showcase 成果实体
     */
    default void beforeSave(ByaiShowcase showcase) {
        // 默认不进行任何处理
    }

    /**
     * 更新前的预处理逻辑
     *
     * @param showcase 成果实体
     */
    default void beforeUpdate(ByaiShowcase showcase) {
        // 默认不进行任何处理
    }

    /**
     * 构建成果详情信息
     *
     * @param showcase 成果实体
     * @return 详情信息
     */
    default ShowcaseDetailDto buildDetail(ByaiShowcase showcase) {
        return ShowcaseDetailDto.basicOf(showcase);
    }

    /**
     * 下载成果内容
     *
     * @param showcase 成果实体
     * @return 下载结果
     */
    default ShowcaseDownloadResult download(ByaiShowcase showcase) {
        throw new UnsupportedOperationException(I18nUtil.get("showcase.strategy.download.type.not.supported", showcase.getType()));
    }
}





