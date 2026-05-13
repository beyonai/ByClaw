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
} from '@ant-design/icons';

// Hardcoded menu config for the manager sider
export const menuConfig = [
  // {
  //   path: '/manager/operation/dashboard',
  //   name: 'managerDashboard',
  //   localeId: 'menu.operation.dashboard',
  //   icon: DashboardOutlined,
  // },
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
  // {
  //   path: '/manager/asset/digitalEmployee',
  //   name: '数字员工管理',
  //   localeId: 'menu.resourceMgr.digitalEmployee',
  //   icon: RobotOutlined,
  // },
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
];

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
