export const CATEGORIES = {
  fuel: { key: 'fuel', label: '加油', color: '#cb912f', icon: 'fuel', unit: 'L' },
  charge: { key: 'charge', label: '充电', color: '#0f7b6c', icon: 'bolt', unit: 'kWh' },
  parking: { key: 'parking', label: '停车', color: '#2383e2', icon: 'parking', unit: '' },
  toll: { key: 'toll', label: '过路费', color: '#6940a5', icon: 'road', unit: '' },
  insurance: { key: 'insurance', label: '保险', color: '#337ea9', icon: 'shield', unit: '' },
  repair: { key: 'repair', label: '维修', color: '#eb5757', icon: 'wrench', unit: '' },
  wash: { key: 'wash', label: '洗车美容', color: '#d9730d', icon: 'sparkles', unit: '' },
  other: { key: 'other', label: '其他', color: '#9b9a97', icon: 'dots', unit: '' },
  maintenance: { key: 'maintenance', label: '保养', color: '#0f7b6c', icon: 'settings', unit: '' }
};

export const CATEGORY_LIST = Object.values(CATEGORIES).filter((c) => c.key !== 'maintenance');

export const ENERGY_TYPES = {
  fuel: { label: '燃油车', short: '燃油', color: '#cb912f', consumptionUnit: 'L/100km', unit: 'L' },
  ev: { label: '纯电车', short: '纯电', color: '#0f7b6c', consumptionUnit: 'kWh/100km', unit: 'kWh' },
  phev: { label: '插电混动', short: '混动', color: '#6940a5', consumptionUnit: '综合', unit: '' }
};

export const SOURCE_LABELS = {
  manual: '手动',
  agent: 'Agent',
  import: '导入',
  demo: '示例'
};

export const STATUS_META = {
  overdue: { label: '已到期', color: 'danger' },
  soon: { label: '即将到期', color: 'warn' },
  ok: { label: '正常', color: 'success' },
  unknown: { label: '待设置', color: 'muted' }
};

export const ROUTES = [
  { key: 'dashboard', label: '概览', icon: 'dashboard', title: '用车概览', subtitle: '本月花费、能耗与保养状态一目了然' },
  { key: 'expenses', label: '费用', icon: 'wallet', title: '费用管理', subtitle: '记录加油、充电、停车、保险与维修支出' },
  { key: 'energy', label: '能耗', icon: 'gauge', title: '能耗分析', subtitle: '平均油耗、电耗与能源成本趋势' },
  { key: 'maintenance', label: '保养', icon: 'wrench', title: '保养管理', subtitle: '计划提醒、到期跟踪与维修保养历史' },
  { key: 'reports', label: '报告', icon: 'report', title: '用车报告', subtitle: '月度、年度与累计报告，一键导出图片' },
  { key: 'vehicles', label: '车辆', icon: 'car', title: '车辆管理', subtitle: '多车独立统计费用、能耗与保养' },
  { key: 'settings', label: '数据', icon: 'database', title: '数据与设置', subtitle: '导出、备份、WebDAV 同步与 Agent 接入' }
];
