package com.iwhalecloud.byai.manager.vo.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;

import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ShelfResourceVo extends SsResource {

    /**
     * 资源关联的来源类型如插件下的工具，工具的resourceSourceType为PLUGIN
     */
    private String resourceSourceType;

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }

        if (o == null || getClass() != o.getClass()) {
            return false;
        }
        // 先判断父类属性是否相�?
        if (!super.equals(o)) {
            return false;
        }

        ShelfResourceVo that = (ShelfResourceVo) o;

        // 比较当前类的新增属�?resourceSourceType
        if (resourceSourceType == null) {
            return that.resourceSourceType == null;
        }
        else {
            return resourceSourceType.equals(that.resourceSourceType);
        }
    }

    /**
     * @return
     */
    @Override
    public int hashCode() {
        return super.hashCode();
    }
}
