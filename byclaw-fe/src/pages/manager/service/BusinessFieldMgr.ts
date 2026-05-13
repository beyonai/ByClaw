import { POST } from '@/service/common/request';

// 获取业务领域树 (catalogType: 6)
export async function getFieldTree(params: any) {
  return POST('/byaiService/catalog/queryCatalogTree', {
    keyword: params?.keyword || '',
    catalogType: 6,
    ...params,
  });
}

// 新增业务领域
export async function createCatalog(params: any) {
  return POST('/byaiService/catalog/create', {
    ...params,
  });
}

// 更新业务领域
export async function updateCatalog(params: any) {
  return POST('/byaiService/catalog/update', {
    ...params,
  });
}

// 删除业务领域
export async function deleteCatalog(params: any) {
  return POST('/byaiService/catalog/delete', {
    ...params,
  });
}

// 获取业务领域的资产列表
export async function queryResourceListByCatalogId(params: any) {
  return POST('/byaiService/catalog/queryResourceListByCatalogId', {
    ...params,
  });
}
