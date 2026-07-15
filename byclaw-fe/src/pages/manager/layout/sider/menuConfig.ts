import {
  ApartmentOutlined,
  AppstoreOutlined,
  CodeSandboxOutlined,
  ControlOutlined,
  // DashboardOutlined,
  ExperimentOutlined,
  // RobotOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  RadarChartOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { getDcSystemConfig } from '@/pages/manager/service/session';

const MANAGER_MENU_PARAM_CODE = 'SYSTEM_BACKEND_MENU_MANAGE';
let managerMenuConfigPromise: Promise<any[]> | null = null;
let managerMenuConfigCache: any[] | null = null;

const iconByMenuCode: Record<string, any> = {
  menu_org: ApartmentOutlined,
  menu_staff_post: TeamOutlined,
  menu_role_permission: SafetyCertificateOutlined,
  menu_asset_catalog: AppstoreOutlined,
  menu_param_config: ControlOutlined,
  menu_model_config: ExperimentOutlined,
  menu_sandbox_config: CodeSandboxOutlined,
  menu_ui_agent: RadarChartOutlined,
  menu_storage_quota: DatabaseOutlined,
};

const localeIdByPath: Record<string, string> = {
  '/manager/org/orgMgr': 'menu.orgCenter.orgMgr',
  '/manager/org/postManage': 'menu.orgCenter.postManage',
  '/manager/org/permissionGroup': 'menu.orgCenter.permissionGroup',
  '/manager/business/field': 'menu.business.field',
  '/manager/systemParams/system': 'menu.systemParams.system',
  '/manager/systemParams/modal': 'menu.systemParams.modal',
  '/manager/systemParams/sandbox': 'menu.systemParams.sandbox',
  '/manager/notification': 'menu.business.notification',
  '/manager/storageQuota': 'menu.storageQuota',
};

export const fallbackMenuConfig = [
  {
    path: '/manager/org/orgMgr',
    name: '组织结构管理',
    localeId: 'menu.orgCenter.orgMgr',
    icon: ApartmentOutlined,
  },
  {
    path: '/manager/org/postManage',
    name: '员工岗位管理',
    localeId: 'menu.orgCenter.postManage',
    icon: TeamOutlined,
  },
  {
    path: '/manager/org/permissionGroup',
    name: '角色权限管理',
    localeId: 'menu.orgCenter.permissionGroup',
    icon: SafetyCertificateOutlined,
  },
  {
    path: '/manager/business/field',
    name: '资产目录管理',
    localeId: 'menu.business.field',
    icon: AppstoreOutlined,
  },
  {
    path: '/manager/systemParams/system',
    name: '参数配置管理',
    localeId: 'menu.systemParams.system',
    icon: ControlOutlined,
  },
  {
    path: '/manager/systemParams/modal',
    name: '模型配置管理',
    localeId: 'menu.systemParams.modal',
    icon: ExperimentOutlined,
  },
  {
    path: '/manager/systemParams/sandbox',
    name: '沙箱配置管理',
    localeId: 'menu.systemParams.sandbox',
    icon: CodeSandboxOutlined,
    adminVipOnly: true,
  },
  {
    path: '/manager/notification',
    name: '通知管理',
    localeId: 'menu.business.notification',
    icon: ExperimentOutlined,
    adminVipOnly: true,
  },
  {
    path: '/manager/storageQuota',
    name: '存储配额管理',
    localeId: 'menu.storageQuota',
    icon: DatabaseOutlined,
    adminVipOnly: true,
  },
];

const REQUIRED_MANAGER_MENU_PATHS = new Set(['/manager/storageQuota']);

const mergeRequiredManagerMenus = (menus: any[]) => {
  const existingPaths = new Set(menus.map((item) => item.routePath || item.path));
  const requiredMenus = fallbackMenuConfig
    .filter((item) => REQUIRED_MANAGER_MENU_PATHS.has(item.path) && !existingPaths.has(item.path))
    .map((item) => ({ ...item, key: item.path, routePath: item.path }));
  return [...menus, ...requiredMenus];
};

const parseConfigList = (value: any) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getMenuKey = (item: any) => item.path || item.menuUrl || item.menuCode;

export const normalizeMenuUrl = (url?: string) => {
  if (!url) {
    return '';
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `https://${url}`;
};

export const normalizeManagerMenuConfig = (menus: any[]) =>
  menus
    .slice()
    .sort((a, b) => (a.menuOrder || 0) - (b.menuOrder || 0))
    .map((item) => ({
      ...item,
      key: getMenuKey(item),
      path: getMenuKey(item),
      routePath: item.path,
      name: item.menuNameCn || item.menuNameEn || item.menuCode,
      nameEn: item.menuNameEn,
      localeId: localeIdByPath[item.path],
      icon: iconByMenuCode[item.menuCode] || AppstoreOutlined,
    }))
    .filter((item) => item.path);

export const resetManagerMenuConfigCache = () => {
  managerMenuConfigPromise = null;
  managerMenuConfigCache = null;
};

export const getManagerMenuConfig = async (options?: { refresh?: boolean }) => {
  if (options?.refresh) {
    managerMenuConfigPromise = null;
    managerMenuConfigCache = null;
  }

  if (managerMenuConfigCache) {
    return managerMenuConfigCache;
  }

  if (!managerMenuConfigPromise) {
    managerMenuConfigPromise = getDcSystemConfig({
      paramCode: MANAGER_MENU_PARAM_CODE,
    })
      .then((res) => {
        const response: any = res;
        const list = parseConfigList(response?.paramValue || response?.data?.paramValue || response?.data || response);
        const remoteMenus = normalizeManagerMenuConfig(list);
        const menus = remoteMenus.length > 0 ? mergeRequiredManagerMenus(remoteMenus) : [];

        if (menus.length > 0) {
          managerMenuConfigCache = menus;
        } else {
          managerMenuConfigPromise = null;
        }

        return menus;
      })
      .catch((error) => {
        managerMenuConfigPromise = null;
        throw error;
      });
  }

  return managerMenuConfigPromise;
};

export const filterMenusByAdminVip = (menus: any[], hasAdminVipPermission: boolean): any[] =>
  menus
    .map((item) => {
      if (item.adminVipOnly && !hasAdminVipPermission) {
        return null;
      }

      const routes = item.routes ? filterMenusByAdminVip(item.routes, hasAdminVipPermission) : undefined;

      if (item.routes && routes?.length === 0 && !item.component) {
        return null;
      }

      return {
        ...item,
        routes,
      };
    })
    .filter(Boolean);

export const filterMenusByMenuDisplay = (menus: any[], userInfo: any): any[] => {
  const userTypeList = (userInfo?.usersOrganizations || []).map((item: any) => item.userType);

  if (!userTypeList.length) {
    return menus;
  }

  return menus.filter((item) => {
    if (!Array.isArray(item.menuDisplay) || item.menuDisplay.length === 0) {
      return true;
    }

    return item.menuDisplay.some((role: string) => userTypeList.includes(role));
  });
};
