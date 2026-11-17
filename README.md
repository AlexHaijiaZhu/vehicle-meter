# 车记 · Vehicle Meter

本地优先的用车管理应用。一个 Docker 容器、一个 SQLite 文件，覆盖费用、能耗、保养、报告、多车、WebDAV 备份与 PWA 安装。

界面风格参考 Notion：浅灰侧栏、白底、细边框、克制的排版与配色。

## 功能

- **费用管理**：加油、充电、停车、过路费、保险、维修、洗车、其他；费用构成、月度趋势、每公里成本。
- **能耗分析**：满箱法油耗、充电区间电耗、能源单价与百公里能源成本。
- **保养管理**：里程 / 时间双周期计划、到期提醒、保养历史、官方来源链接。
- **用车报告**：月度、年度、累计、自定义周期；导出高清 PNG；一键分享卡片（Twitter / X 1200×630）。
- **多车管理**：每辆车独立统计费用、能耗、保养与报告。
- **数据管理**：Excel、CSV（ZIP）、完整 JSON 备份与恢复、WebDAV 同步（坚果云 / Nextcloud / 群晖等）。
- **PWA**：安装到手机主屏幕 / 桌面，全屏运行；Service Worker 离线壳。
- **Agent 集成**：
  - 结构化费用录入 API（Agent 识别小票后提交 JSON，后端不做图片 OCR）。
  - **MCP 保养计划批量导入**：告诉 Agent 车型，Agent 联网查询官方保养手册，通过 MCP 工具批量建计划。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js ≥ 22.13（Docker 使用 Node 24 Alpine） |
| 后端 | Node 原生 `http` + 内置 `node:sqlite`，零运行时依赖 |
| 数据库 | SQLite（WAL，自动建表与迁移） |
| 前端 | 原生 ES Modules + 自绘 SVG 图表 + Canvas 分享卡，无构建步骤 |
| 部署 | 单容器 Docker / Docker Compose |
| 集成 | REST API、stdio MCP server、PWA、WebDAV |

> 没有 Vue / React / 打包器。目标是单容器、零构建、低依赖；如果未来要做大型多用户协作，再考虑升级前端框架与 PostgreSQL。

## 快速开始

### Docker Compose（推荐）

```bash
docker compose up -d --build
```

打开 <http://localhost:8080>。

### 发布到 GitHub / GHCR（可选）

**源码托管**

```bash
git init -b main
git add .
git commit -m "feat: vehicle meter"
git remote add origin https://github.com/<github-user>/vehicle-meter.git
git push -u origin main
```

**GHCR 镜像**

仓库已附带 `.github/workflows/publish-ghcr.yml`，使用 GitHub 自带的 `GITHUB_TOKEN`，不需要额外 Secret，自动构建 `linux/amd64` + `linux/arm64`：

1. 把代码推到 GitHub。
2. 推送版本标签，或手动运行 workflow：

```bash
git tag v1.0.0
git push origin v1.0.0
```

3. 完成后镜像地址为：

```text
ghcr.io/<github-user>/vehicle-meter:1.0.0
ghcr.io/<github-user>/vehicle-meter:1.0
ghcr.io/<github-user>/vehicle-meter:latest
ghcr.io/<github-user>/vehicle-meter:sha-xxxxxxx
```

GitHub 个人账号的 Package 默认可能是私有。需要公开拉取时：GitHub → 个人主页 → **Packages** → `vehicle-meter` → **Package settings** → **Change visibility** → Public。

私有镜像拉取：

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
docker pull ghcr.io/<github-user>/vehicle-meter:latest
```

使用镜像启动：

```yaml
services:
  vehicle-meter:
    image: ghcr.io/<github-user>/vehicle-meter:latest
    container_name: vehicle-meter
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      TZ: Asia/Shanghai
      APP_PASSWORD: ${APP_PASSWORD:-}
    volumes:
      - vehicle-meter-data:/data
volumes:
  vehicle-meter-data:
```

> 工作流在 `main` 推送以及 `v*.*.*` 标签推送时自动构建并发布 GHCR 镜像，无需额外 Secret。

持久化数据在命名卷 `vehicle-meter-data` 中：

```bash
docker compose logs -f
docker compose down          # 停止，数据保留
```

可选环境变量放在 `.env`：

```dotenv
PORT=8080
APP_PASSWORD=your-password   # 留空则不启用登录
TZ=Asia/Shanghai
```

设置 `APP_PASSWORD` 后，浏览器会弹出 HTTP Basic Auth 登录框。

### 本地开发

需要 Node.js ≥ 22.13（内置 `node:sqlite`）：

```bash
node --version
npm start
```

无需 `npm install`（项目没有运行时依赖）。默认访问 <http://localhost:8080>，数据库在 `data/vehicle-meter.sqlite`。

```bash
npm test                     # 运行 API / 导入 / 备份 / MCP / PWA 测试
node test/api.test.js        # 同上，适合受限环境
```

### 首次使用

1. 添加车辆（名称、车型、能源类型、初始里程）。
2. 在「费用」记录第一笔加油 / 充电 / 停车；在「保养」建计划。
3. 「报告」选择月份或年度，导出 PNG 或分享卡片。
4. 在「数据」配置 WebDAV 或导出完整备份。

没有数据时可以点「加载示例数据」体验。

## Agent / MCP：按官方保养手册批量导入

### 工作流

1. 用户告诉 Agent 车型，例如「我的车是 2023 大众高尔夫 280TSI」。
2. Agent 调用 `list_vehicles` 确认车记中的车辆与车型 / 年款。
3. Agent 联网检索厂商官方保养手册（或用户提供的官方页面）。
4. Agent 整理为保养计划 JSON，先 `dryRun` 预览，再正式调用 `import_maintenance_plans`。
5. 车记按 `externalId`（或计划名称）幂等 upsert，保存 `sourceUrl`，在计划卡片上显示「官方来源」。

> Agent 必须提供真实来源，不应编造周期。官方建议仅作计划参考，实际保养以车辆状况、厂家最新要求与维修店检查为准。

### 启动 MCP server

MCP server 是一个零依赖的 stdio JSON-RPC 进程，通过 HTTP 调用正在运行的车记。

**宿主机（Node）**

```json
{
  "mcpServers": {
    "vehicle-meter": {
      "command": "node",
      "args": ["/absolute/path/to/vehicle-meter/mcp/server.js"],
      "env": {
        "VEHICLE_METER_URL": "http://127.0.0.1:8080",
        "VEHICLE_METER_PASSWORD": ""
      }
    }
  }
}
```

**Docker 内部执行**

```json
{
  "mcpServers": {
    "vehicle-meter": {
      "command": "docker",
      "args": ["exec", "-i", "vehicle-meter", "node", "/app/mcp/server.js"]
    }
  }
}
```

`docker-compose.yml` 已把 `APP_PASSWORD` 同时注入为 `VEHICLE_METER_PASSWORD`，容器内 MCP 可自动认证。

可用工具：

| 工具 | 作用 |
| --- | --- |
| `list_vehicles` | 列出车辆，含车型、年款、当前里程、下一次保养 |
| `get_maintenance_plans` | 查看现有计划与到期状态 |
| `import_maintenance_plans` | 批量导入计划，支持 `dryRun`、`deactivateMissing`、`sourceUrl` |
| `create_vehicle` | 当车辆不存在时先创建 |

### 直接调用 HTTP API

```bash
curl -X POST http://localhost:8080/api/agent/maintenance-plans \
  -H "Content-Type: application/json" \
  -d '{
    "vehiclePlate": "沪A·8K2M9",
    "source": "official",
    "sourceUrl": "https://www.vw.com.cn/",
    "dryRun": false,
    "items": [
      {
        "name": "更换机油机滤",
        "intervalMileage": 10000,
        "intervalMonths": 12,
        "items": "机油, 机滤",
        "notes": "官方保养手册建议每 10000 km 或 12 个月",
        "externalId": "vw-golf-oil-filter"
      },
      {
        "name": "更换刹车油",
        "intervalMonths": 24,
        "items": "刹车油",
        "externalId": "vw-golf-brake-fluid"
      }
    ]
  }'
```

完整 Schema 与示例：

```bash
curl http://localhost:8080/api/agent/maintenance-schema
```

### 幂等与更新

- 同一车辆下 `externalId` 唯一；重复导入会更新原计划。
- 没有 `externalId` 时按计划名称匹配现有计划。
- 新建计划若未提供上次保养信息，会从当前里程 / 当前日期起算下一次到期，避免刚导入就全部标红。
- `deactivateMissing: true`：导入后停用该车未出现在本次导入中的非手动计划，适合整表刷新。

### Agent 费用录入（无图片 OCR）

图片识别由 Agent 完成，车记只接收结构化 JSON：

```bash
curl -X POST http://localhost:8080/api/agent/expenses \
  -H "Content-Type: application/json" \
  -d '{
    "vehiclePlate": "沪A·8K2M9",
    "category": "fuel",
    "date": "2026-11-17",
    "amount": 320.5,
    "quantity": 40.06,
    "unitPrice": 8.0,
    "odometer": 32380,
    "station": "中国石化 漕河泾站",
    "fuelType": "95#",
    "fullTank": true,
    "externalId": "agent-20261117-001"
  }'
```

`GET /api/agent/schema` 返回字段说明和 JSON Schema。金额必填；数量、单价、金额任意两个即可推导第三个。

## PWA：安装到手机 / 桌面

- 应用已包含 `manifest.webmanifest`、192/512 PNG 图标、Apple Touch Icon 与 Service Worker。
- Android Chrome / Edge：地址栏安装图标，或菜单「安装应用」。
- iPhone / iPad：Safari → 分享 → 添加到主屏幕。
- 桌面 Chrome / Edge：地址栏右侧安装图标。

**HTTPS 要求**：Service Worker 与 Chrome 的 PWA 安装要求安全上下文。手机通过局域网 `http://192.168.x.x:8080` 访问时，Android 的安装与离线缓存通常不可用；生产环境建议在容器前加 HTTPS 反向代理（Caddy / Nginx / Traefik）。iOS 的「添加到主屏幕」可先用 HTTP。

安装入口在「数据与设置 → 安装到手机 / 桌面」，顶栏也会在可安装时显示下载图标。

## 数据、导出与备份

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| Excel | 费用 / 数据页 | 车辆、费用明细、保养记录、计划、月度汇总 |
| CSV | 费用 / 数据页 | UTF-8 BOM；「全部」导出为 ZIP |
| 完整备份 | 数据页 | JSON，包含车辆、费用、计划、记录、设置（含 WebDAV 密码） |
| 恢复 | 数据页 | 覆盖当前全部数据，保留原 ID |
| WebDAV | 数据页 | 兼容坚果云、Nextcloud、群晖；支持测试、备份、从远端恢复 |

**坚果云**：在「账户信息 → 安全选项」添加应用密码，WebDAV 地址填 `https://dav.jianguoyun.com/dav/`，使用应用密码而不是登录密码。

> 完整备份包含 WebDAV 密码等敏感设置，请勿公开分享。WebDAV 密码在本地 SQLite 中以明文保存，这是单用户自托管场景的取舍。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录（Docker 中 `/data`） |
| `DB_PATH` | `$DATA_DIR/vehicle-meter.sqlite` | SQLite 文件路径 |
| `APP_PASSWORD` | 空 | 设置后启用 HTTP Basic Auth |
| `TZ` | 系统时区 | 影响「今天」、月度统计；Docker Compose 默认 `Asia/Shanghai` |
| `MAX_BODY_BYTES` | `31457280` | JSON 请求体上限 |
| `LOG_REQUESTS` | 关闭 | 设为 `1` 打印请求日志 |

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（无需认证） |
| GET | `/api/bootstrap` | 启动数据：车辆、设置、分类、计数 |
| GET/POST | `/api/vehicles` | 车辆列表 / 新增 |
| PUT/DELETE | `/api/vehicles/:id` | 更新 / 归档（`?hard=1` 彻底删除） |
| GET/POST | `/api/expenses` | 费用列表 / 新增 |
| PUT/DELETE | `/api/expenses/:id` | 更新 / 删除 |
| GET/POST | `/api/plans` | 保养计划（含到期状态）/ 新增 |
| PUT/DELETE | `/api/plans/:id` | 更新 / 删除 |
| GET/POST | `/api/maintenance` | 保养记录 / 新增 |
| GET | `/api/stats/dashboard` | 概览统计 |
| GET | `/api/stats/energy` | 能耗统计 |
| GET | `/api/reports` | 月度 / 年度 / 累计 / 自定义报告 |
| GET | `/api/card` | 分享卡片数据（默认近 3 个月） |
| POST | `/api/agent/expenses` | Agent 费用录入（幂等） |
| POST | `/api/agent/maintenance-plans` | Agent 保养计划批量导入 |
| GET | `/api/agent/schema` | 费用录入 Schema |
| GET | `/api/agent/maintenance-schema` | 保养导入 Schema |
| GET | `/api/export/xlsx` | Excel 导出 |
| GET | `/api/export/csv?kind=all` | CSV / ZIP 导出 |
| GET/POST | `/api/backup`、`/api/restore` | 完整备份 / 恢复 |
| GET/PUT | `/api/settings` | 设置（WebDAV 密码不回传） |
| POST | `/api/webdav/test`、`backup`、`restore` | WebDAV 操作 |

## 目录结构

```
.
├── server.js               # HTTP 服务、静态资源、鉴权
├── src/
│   ├── api.js              # REST 路由、Agent 录入、导入导出
│   ├── db.js               # SQLite schema / 迁移
│   ├── stats.js            # 油耗、电耗、报告、卡片计算
│   ├── xlsx.js             # 原生 XLSX / ZIP 生成
│   ├── webdav.js           # WebDAV 客户端
│   ├── demo.js             # 示例数据
│   └── util.js             # 日期、校验、CSV
├── mcp/server.js           # stdio MCP server（无依赖）
├── public/
│   ├── index.html
│   ├── css/app.css         # 布局与响应式
│   ├── css/notion.css      # Notion 风格皮肤
│   ├── js/                 # 原生 SPA、图表、Canvas 分享卡、PWA
│   ├── icons/              # PWA 图标
│   ├── manifest.webmanifest
│   └── sw.js               # Service Worker
├── scripts/make-icons.mjs  # 重新生成 PWA 图标
├── test/api.test.js
├── Dockerfile
└── docker-compose.yml
```

## 计算口径

- **油耗**：默认满箱法。相邻两次「加满」之间累计的加油量 ÷ 仪表里程差 × 100，单位 L/100km。
- **电耗**：相邻两次充电记录之间，本次充电量 ÷ 里程差 × 100，单位 kWh/100km。
- **里程**：取费用与保养记录中的仪表里程，加上车辆初始里程；区间首尾没有读数时使用最近读数估算。
- **成本**：日常费用 + 保养记录费用；每公里成本 = 总支出 ÷ 区间里程。
- **保养到期**：优先使用显式「下次到期」；否则按上次保养 / 购车日期 + 周期计算。临期阈值默认 30 天 / 500 km。
- **分享卡片**：最近 3 个月平均油耗 / 电耗、里程、总支出、每公里成本、当前里程、下一次保养、近 4 个月支出。

## 安全与限制

- 单用户、单实例设计；SQLite 适合个人 / 家庭数据量，不适合多实例同时写。
- 默认无登录；公网部署务必设置 `APP_PASSWORD` 并加 HTTPS。
- 没有内置 TLS。请用 Caddy / Nginx / Traefik 等反向代理提供 HTTPS。
- WebDAV 密码在 SQLite 明文保存；完整备份也会包含它。
- 官方保养数据由 Agent 联网获取并写入，应用不内置任何厂商手册，也不保证第三方数据的准确性。
- 智能识别不由应用完成：Agent 负责识图，应用只接收结构化 JSON。

## 开发说明

- 前端直接修改 `public/`，刷新即可；静态资源使用 `no-cache` + ETag。
- 数据库迁移在 `src/db.js`，当前 schema 版本 2；新增字段会自动 `ALTER TABLE`。
- 分享卡 / 报告图在 `public/js/sharecard.js`，使用原生 Canvas。
- 重新生成图标：

```bash
node scripts/make-icons.mjs
```

- 修改前端代码后，如需让已安装的 PWA 更新缓存，提升 `public/sw.js` 中的 `CACHE` 版本号。

## License

个人项目，未附带特定开源许可证。使用前请自行确认第三方数据与厂商手册的版权要求。
