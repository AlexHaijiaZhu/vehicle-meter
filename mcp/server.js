#!/usr/bin/env node
/**
 * 车记 MCP server (stdio JSON-RPC 2.0)
 *
 * Tools:
 *   list_vehicles
 *   get_maintenance_plans
 *   import_maintenance_plans
 *   create_vehicle
 *
 * Env:
 *   VEHICLE_METER_URL       default http://127.0.0.1:8080
 *   VEHICLE_METER_USERNAME  default app (HTTP Basic auth user)
 *   VEHICLE_METER_PASSWORD  optional; must match APP_PASSWORD
 *   VEHICLE_METER_TIMEOUT_MS default 20000
 */
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_NAME = 'vehicle-meter-mcp';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const BASE_URL = (process.env.VEHICLE_METER_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const USERNAME = process.env.VEHICLE_METER_USERNAME || 'app';
const PASSWORD = process.env.VEHICLE_METER_PASSWORD || '';
const TIMEOUT = Math.max(Number(process.env.VEHICLE_METER_TIMEOUT_MS) || 20000, 1000);

async function apiRequest(endpoint, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
  }
  let response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? '请求超时' : err?.message || '网络错误';
    throw new Error(`无法连接车记服务（${BASE_URL}）：${reason}`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('车记服务认证失败，请检查 VEHICLE_METER_PASSWORD');
    throw new Error(payload?.error || `车记接口返回 HTTP ${response.status}`);
  }
  return payload;
}

async function vehicleList() {
  const result = await apiRequest('/api/vehicles/summary');
  return (result.items || []).filter((vehicle) => !vehicle.archived);
}

function pickVehicle(vehicles, args = {}) {
  if (args.vehicleId != null) {
    const byId = vehicles.find((v) => Number(v.id) === Number(args.vehicleId));
    if (!byId) throw new Error(`vehicleId=${args.vehicleId} 的车辆不存在`);
    return byId;
  }
  const plate = String(args.vehiclePlate || args.plate || '').trim().toLowerCase();
  if (plate) {
    const matches = vehicles.filter((v) => String(v.plateNo || '').trim().toLowerCase() === plate);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('车牌匹配到多辆车，请改用 vehicleId');
    throw new Error(`没有找到车牌为 ${args.vehiclePlate} 的车辆`);
  }
  const name = String(args.vehicleName || '').trim().toLowerCase();
  if (name) {
    const matches = vehicles.filter((v) => String(v.name || '').trim().toLowerCase() === name);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('车辆名称匹配到多辆车，请改用 vehicleId');
    throw new Error(`没有找到名称为 ${args.vehicleName} 的车辆`);
  }
  const defaults = vehicles.filter((v) => v.isDefault);
  if (defaults.length === 1) return defaults[0];
  if (vehicles.length === 1) return vehicles[0];
  if (!vehicles.length) throw new Error('车记里还没有车辆，请先使用 create_vehicle 创建');
  throw new Error('有多辆车，请通过 vehicleId / vehiclePlate / vehicleName 指定');
}

function textResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}

const VEHICLE_INPUT = {
  vehicleId: { type: 'integer', description: '车辆 ID（优先级最高）' },
  vehiclePlate: { type: 'string', description: '车牌号，例如 沪A·8K2M9' },
  vehicleName: { type: 'string', description: '车辆名称，例如 小蓝' }
};

const IMPORT_INPUT = {
  ...VEHICLE_INPUT,
  source: {
    type: 'string',
    enum: ['official', 'agent', 'import'],
    default: 'official',
    description: '来源类型。抓取官方保养手册时用 official。'
  },
  sourceUrl: { type: 'string', description: '官方保养手册 / 页面 URL；会随计划保存' },
  deactivateMissing: {
    type: 'boolean',
    default: false,
    description: '导入后停用该车未出现在本次导入中的非手动计划（用于整表刷新）'
  },
  dryRun: { type: 'boolean', default: false, description: '仅校验并返回将执行的操作，不写数据库' },
  items: {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    description: '保养计划列表',
    items: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: '保养项目名称，例如 更换机油机滤' },
        intervalMileage: { type: 'number', description: '周期里程（km）；与 intervalMonths 至少填一个' },
        intervalMonths: { type: 'integer', description: '周期月数' },
        items: { type: 'string', description: '项目清单，逗号分隔，例如 机油, 机滤' },
        notes: { type: 'string', description: '官方建议 / 备注' },
        notifyDays: { type: 'integer', default: 30, description: '提前提醒天数' },
        externalId: { type: 'string', description: '幂等键；重复导入同一项目会更新原计划' },
        sourceUrl: { type: 'string', description: '单个项目的来源链接（可选）' }
      }
    }
  }
};

const TOOLS = [
  {
    name: 'list_vehicles',
    description:
      '列出车记中全部车辆（含车型 brandModel、年款/购车日期、能源类型、当前里程、下一次保养）。在为用户查询官方保养计划前，先调用它确认车型。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_maintenance_plans',
    description:
      '读取指定车辆当前的保养计划与到期状态。用于导入前避免重复，或导入后向用户汇报结果。',
    inputSchema: {
      type: 'object',
      properties: VEHICLE_INPUT,
      additionalProperties: false
    }
  },
  {
    name: 'import_maintenance_plans',
    description:
      '批量导入保养计划（按 externalId 或名称幂等 upsert）。Agent 应先确认车辆具体车型/年款，再用联网能力查阅厂商官方保养手册，将官方周期整理为 items 后调用本工具；请提供 sourceUrl 并在 notes 中说明官方建议。不要编造周期。',
    inputSchema: {
      type: 'object',
      properties: IMPORT_INPUT,
      required: ['items'],
      additionalProperties: false
    }
  },
  {
    name: 'create_vehicle',
    description:
      '在车记中新增车辆。若用户只告诉了车型而列表里没有对应车辆，可先创建，再导入保养计划。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '车辆名称，例如 小蓝' },
        plateNo: { type: 'string', description: '车牌号，可选' },
        brandModel: { type: 'string', description: '品牌车型，例如 大众 高尔夫 280TSI' },
        energyType: {
          type: 'string',
          enum: ['fuel', 'ev', 'phev'],
          default: 'fuel',
          description: '能源类型：fuel 燃油 / ev 纯电 / phev 插混'
        },
        fuelType: { type: 'string', description: '油品，例如 95#' },
        purchaseDate: { type: 'string', description: '购车日期 YYYY-MM-DD，可选' },
        initialOdometer: { type: 'number', description: '初始里程 km，默认 0' },
        isDefault: { type: 'boolean', description: '是否设为默认车辆' }
      },
      required: ['name'],
      additionalProperties: false
    }
  }
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'list_vehicles': {
      const vehicles = await vehicleList();
      return textResult({
        ok: true,
        baseUrl: BASE_URL,
        count: vehicles.length,
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle.id,
          name: vehicle.name,
          plateNo: vehicle.plateNo,
          brandModel: vehicle.brandModel,
          energyType: vehicle.energyType,
          fuelType: vehicle.fuelType,
          purchaseDate: vehicle.purchaseDate,
          latestOdometer: vehicle.latestOdometer,
          nextMaintenance: vehicle.nextMaintenance
        })),
        hint: '如需查询官方保养周期，请使用 brandModel + purchaseDate 年款检索厂商官网，再调用 import_maintenance_plans。'
      });
    }
    case 'get_maintenance_plans': {
      const vehicles = await vehicleList();
      const vehicle = pickVehicle(vehicles, args);
      const plans = await apiRequest(`/api/plans?vehicleId=${encodeURIComponent(vehicle.id)}&includeInactive=1`);
      return textResult({
        ok: true,
        vehicle: { id: vehicle.id, name: vehicle.name, plateNo: vehicle.plateNo, brandModel: vehicle.brandModel },
        latestOdometer: plans.latestOdometer,
        plans: plans.items
      });
    }
    case 'import_maintenance_plans': {
      const vehicles = await vehicleList();
      const vehicle = pickVehicle(vehicles, args);
      if (!Array.isArray(args.items) || !args.items.length) throw new Error('items 必须是非空数组');
      const payload = {
        vehicleId: vehicle.id,
        source: args.source || 'official',
        sourceUrl: args.sourceUrl || args.source_url || '',
        deactivateMissing: Boolean(args.deactivateMissing),
        dryRun: Boolean(args.dryRun),
        items: args.items
      };
      const result = await apiRequest('/api/agent/maintenance-plans', { method: 'POST', body: payload });
      return textResult({
        ...result,
        vehicle: {
          id: vehicle.id,
          name: vehicle.name,
          plateNo: vehicle.plateNo,
          brandModel: vehicle.brandModel
        },
        hint: result.dryRun
          ? '这是 dryRun，结果未写入。确认无误后去掉 dryRun 再调用一次。'
          : `已处理 ${result.created.length} 条新建、${result.updated.length} 条更新${result.failed.length ? `，${result.failed.length} 条失败` : ''}。`
      });
    }
    case 'create_vehicle': {
      if (!args.name || !String(args.name).trim()) throw new Error('name 不能为空');
      const created = await apiRequest('/api/vehicles', {
        method: 'POST',
        body: {
          name: args.name,
          plateNo: args.plateNo || '',
          brandModel: args.brandModel || '',
          energyType: args.energyType || 'fuel',
          fuelType: args.fuelType || '',
          purchaseDate: args.purchaseDate || null,
          initialOdometer: args.initialOdometer ?? 0,
          isDefault: Boolean(args.isDefault)
        }
      });
      return textResult({ ok: true, vehicle: created });
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;
  if (isNotification) return null;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions:
              '车记用车管理 MCP。需要查询或导入保养计划时：先 list_vehicles 确认车辆与车型/年款；再联网查阅厂商官方保养手册；最后调用 import_maintenance_plans（建议先 dryRun）并附 sourceUrl。不要编造官方周期。'
          }
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const toolName = params?.name;
        if (!toolName) throw new Error('缺少工具名称');
        try {
          const result = await callTool(toolName, params?.arguments || {});
          return { jsonrpc: '2.0', id, result };
        } catch (err) {
          return { jsonrpc: '2.0', id, result: errorResult(err.message || '工具调用失败') };
        }
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      case 'logging/setLevel':
        return { jsonrpc: '2.0', id, result: {} };
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err.message || 'Internal error' }
    };
  }
}

function start() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let closed = false;
  const maybeExit = () => {
    if (closed && pending === 0) setTimeout(() => process.exit(0), 60);
  };
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    pending++;
    try {
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        return;
      }
      const response = await handleMessage(message);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } finally {
      pending--;
      maybeExit();
    }
  });
  rl.on('close', () => {
    closed = true;
    maybeExit();
  });
  console.error(`[${SERVER_NAME}] ready · ${BASE_URL}`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) start();

export { TOOLS, handleMessage, callTool };
