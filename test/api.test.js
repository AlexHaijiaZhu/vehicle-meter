import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { startServer } from '../server.js';

let app;
let base;
let testDir;
let vehicleId;
let backup;
let restoreExpenseId;

async function request(method, endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} -> ${response.status}: ${text}`);
  }
  return { response, data };
}

before(async () => {
  testDir = path.resolve('data', 'tests', `run-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  app = await startServer({ port: 0, host: '127.0.0.1', dbPath: path.join(testDir, 'test.sqlite') });
  base = app.url;
});

after(async () => {
  if (app) await app.close();
  if (testDir) {
    // Windows may keep SQLite handles briefly after close.
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
});

test('health and empty bootstrap', async () => {
  const health = await request('GET', '/api/health');
  assert.equal(health.data.ok, true);
  const boot = await request('GET', '/api/bootstrap');
  assert.equal(boot.data.vehicles.length, 0);
  assert.equal(boot.data.app.name, '车记');
});

test('create vehicle and expense', async () => {
  const vehicle = await request('POST', '/api/vehicles', {
    name: '测试车',
    plateNo: '沪A·TEST1',
    brandModel: '大众 高尔夫 280TSI',
    energyType: 'fuel',
    fuelType: '95#',
    purchaseDate: '2024-01-10',
    initialOdometer: 10000
  });
  vehicleId = vehicle.data.id;
  assert.ok(vehicleId);

  const expense = await request('POST', '/api/expenses', {
    vehicleId,
    category: 'fuel',
    amount: 320,
    quantity: 40,
    occurredOn: '2026-05-01',
    odometer: 12000,
    station: '测试加油站',
    fullTank: true
  });
  assert.equal(expense.data.amount, 320);
  assert.equal(expense.data.quantity, 40);

  const list = await request('GET', `/api/expenses?vehicleId=${vehicleId}`);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.items[0].station, '测试加油站');

  const dashboard = await request('GET', `/api/stats/dashboard?vehicleId=${vehicleId}&from=2026-05-01&to=2026-05-31`);
  assert.equal(dashboard.data.cost.total, 320);
});

test('maintenance plan batch import is idempotent and keeps source', async () => {
  const dry = await request('POST', '/api/agent/maintenance-plans', {
    vehicleId,
    source: 'official',
    sourceUrl: 'https://example.com/manual',
    dryRun: true,
    items: [
      { name: '更换机油机滤', intervalMileage: 10000, intervalMonths: 12, externalId: 'oil-filter', items: '机油, 机滤' },
      { name: '更换空调滤芯', intervalMonths: 24, externalId: 'cabin-filter' }
    ]
  });
  assert.equal(dry.data.dryRun, true);
  assert.equal(dry.data.wouldCreate.length, 2);

  const created = await request('POST', '/api/agent/maintenance-plans', {
    vehicleId,
    source: 'official',
    sourceUrl: 'https://example.com/manual',
    items: [
      { name: '更换机油机滤', intervalMileage: 10000, intervalMonths: 12, externalId: 'oil-filter', items: '机油, 机滤' },
      { name: '更换空调滤芯', intervalMonths: 24, externalId: 'cabin-filter' }
    ]
  });
  assert.equal(created.data.created.length, 2);
  assert.equal(created.data.failed.length, 0);

  const updated = await request('POST', '/api/agent/maintenance-plans', {
    vehicleId,
    source: 'official',
    sourceUrl: 'https://example.com/manual',
    items: [{ name: '更换机油机滤', intervalMileage: 12000, intervalMonths: 12, externalId: 'oil-filter' }]
  });
  assert.equal(updated.data.created.length, 0);
  assert.equal(updated.data.updated.length, 1);

  const plans = await request('GET', `/api/plans?vehicleId=${vehicleId}`);
  const oil = plans.data.items.find((plan) => plan.externalId === 'oil-filter');
  assert.ok(oil);
  assert.equal(oil.source, 'official');
  assert.equal(oil.sourceUrl, 'https://example.com/manual');
  assert.equal(oil.intervalMileage, 12000);
});

test('maintenance record and report', async () => {
  const record = await request('POST', '/api/maintenance', {
    vehicleId,
    serviceOn: '2026-05-10',
    odometer: 12100,
    items: '机油, 机滤',
    cost: 500,
    shop: '测试 4S 店'
  });
  assert.ok(record.data.id);

  const report = await request('GET', `/api/reports?vehicleId=${vehicleId}&period=month&month=2026-05`);
  assert.equal(report.data.cost.total, 820);
  assert.equal(report.data.cost.maintenanceCost, 500);
  assert.equal(report.data.cost.count, 1);
  assert.ok(report.data.insights.length > 0);

  const card = await request('GET', `/api/card?vehicleId=${vehicleId}&months=3`);
  assert.ok(card.data.vehicle);
  assert.equal(typeof card.data.totalCost, 'number');
});

test('exports are valid files', async () => {
  const xlsx = await fetch(`${base}/api/export/xlsx?vehicleId=${vehicleId}`);
  const xlsxBuffer = Buffer.from(await xlsx.arrayBuffer());
  assert.equal(xlsxBuffer[0], 0x50);
  assert.equal(xlsxBuffer[1], 0x4b);

  const csvResponse = await fetch(`${base}/api/export/csv?kind=expenses&vehicleId=${vehicleId}`);
  const csvBuffer = Buffer.from(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBuffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = csvBuffer.toString('utf8');
  assert.ok(csvText.includes('测试加油站'));

  const all = await fetch(`${base}/api/export/csv?kind=all&vehicleId=${vehicleId}`);
  const zipBuffer = Buffer.from(await all.arrayBuffer());
  assert.equal(zipBuffer[0], 0x50);
  assert.equal(zipBuffer[1], 0x4b);
});

test('backup and restore round trip', async () => {
  const response = await fetch(`${base}/api/backup`);
  assert.equal(response.status, 200);
  backup = await response.json();
  assert.ok(backup.data.vehicles.length >= 1);
  assert.ok(backup.data.maintenancePlans.some((plan) => plan.source === 'official'));

  const extra = await request('POST', '/api/expenses', {
    vehicleId,
    category: 'parking',
    amount: 25,
    occurredOn: '2026-05-12'
  });
  restoreExpenseId = extra.data.id;

  const restored = await request('POST', '/api/restore', backup);
  assert.equal(restored.data.ok, true);
  assert.equal(restored.data.counts.vehicles, backup.counts.vehicles);

  const expenses = await request('GET', `/api/expenses?vehicleId=${vehicleId}`);
  assert.equal(expenses.data.total, 1);
  assert.notEqual(expenses.data.items[0].id, restoreExpenseId);
});

test('agent expense idempotency', async () => {
  const payload = {
    vehicleId,
    category: 'fuel',
    date: '2026-05-20',
    amount: 300,
    quantity: 38,
    odometer: 12500,
    externalId: 'agent-test-001'
  };
  const first = await request('POST', '/api/agent/expenses', payload);
  assert.equal(first.data.created.length, 1);
  const second = await request('POST', '/api/agent/expenses', payload);
  assert.equal(second.data.created.length, 0);
  assert.equal(second.data.duplicates.length, 1);
});

test('MCP tools work over HTTP', async () => {
  process.env.VEHICLE_METER_URL = base;
  const mcp = await import(`${pathToFileURL(path.resolve('mcp', 'server.js')).href}?test=${Date.now()}`);
  const initialize = await mcp.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  });
  assert.equal(initialize.result.serverInfo.name, 'vehicle-meter-mcp');

  const toolList = await mcp.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(toolList.result.tools.some((tool) => tool.name === 'import_maintenance_plans'));

  const vehicles = await mcp.handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_vehicles', arguments: {} }
  });
  const vehiclePayload = JSON.parse(vehicles.result.content[0].text);
  assert.ok(vehiclePayload.vehicles.some((vehicle) => vehicle.id === vehicleId));

  const imported = await mcp.handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'import_maintenance_plans',
      arguments: {
        vehicleId,
        dryRun: true,
        sourceUrl: 'https://example.com/mcp-manual',
        items: [{ name: 'MCP 测试计划', intervalMileage: 5000, externalId: 'mcp-test' }]
      }
    }
  });
  const importPayload = JSON.parse(imported.result.content[0].text);
  assert.equal(importPayload.dryRun, true);
  assert.equal(importPayload.wouldCreate.length, 1);
});

test('PWA assets and manifest', async () => {
  const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

  for (const icon of manifest.icons) {
    const response = await fetch(`${base}${icon.src}`);
    assert.equal(response.status, 200, icon.src);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer[0], 0x89);
    assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
  }

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.ok((await sw.text()).includes('vehicle-meter-v1'));
});
