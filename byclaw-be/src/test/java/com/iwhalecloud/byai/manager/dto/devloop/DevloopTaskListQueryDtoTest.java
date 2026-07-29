package com.iwhalecloud.byai.manager.dto.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Date;

import org.junit.jupiter.api.Test;

class DevloopTaskListQueryDtoTest {

    @Test
    void normalizesPaginationDefaultsAndMaximumPageSize() {
        DevloopTaskListQueryDto defaults = new DevloopTaskListQueryDto();
        defaults.normalizeAndValidate();

        assertThat(defaults.getPageNum()).isEqualTo(1);
        assertThat(defaults.getPageSize()).isEqualTo(20);

        DevloopTaskListQueryDto capped = new DevloopTaskListQueryDto();
        capped.setPageNum(0);
        capped.setPageSize(999);
        capped.normalizeAndValidate();

        assertThat(capped.getPageNum()).isEqualTo(1);
        assertThat(capped.getPageSize()).isEqualTo(100);
    }

    @Test
    void rejectsReversedCreationTimeRange() {
        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setCreateTimeStart(new Date(2_000));
        query.setCreateTimeEnd(new Date(1_000));

        assertThatThrownBy(query::normalizeAndValidate)
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("创建时间开始值不能晚于结束值");
    }
}
