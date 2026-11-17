# Vehicle Meter · 车记

[中文](README.md) · **English** · [Français](README.fr.md) · [Español](README.es.md)

A local-first vehicle management app. One Docker container and one SQLite file for expenses, energy use, maintenance, reports, multiple vehicles, WebDAV backup and PWA installation.

The interface is inspired by Notion: light gray sidebar, white canvas, hairline borders and restrained typography.

## Features

- **Expenses**: fuel, charging, parking, tolls, insurance, repairs, car wash and other costs; category breakdown, monthly trend and cost per kilometre.
- **Energy analysis**: full-tank fuel consumption, charge-interval EV consumption, energy unit price and energy cost per 100 km.
- **Maintenance**: dual mileage / time intervals, due reminders, service history and official source links.
- **Reports**: monthly, yearly, all-time and custom ranges; high-resolution PNG export; one-tap social card (Twitter / X 1200×630).
- **Multiple vehicles**: independent expenses, energy, maintenance and reports per vehicle.
- **Data**: Excel, CSV (ZIP), full JSON backup / restore and WebDAV sync (Jianguoyun, Nextcloud, Synology, etc.).
- **PWA**: install on a phone home screen or desktop, run full-screen, with a Service Worker offline shell.
- **Agent integration**:
  - Structured expense API (the Agent reads receipts and posts JSON; the backend does no image OCR).
  - **MCP maintenance-plan import**: tell the Agent the vehicle model, it looks up the official service schedule and bulk-imports plans through MCP.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js ≥ 22.13 (Node 24 Alpine in Docker) |
| Backend | Native `http` + built-in `node:sqlite`, zero runtime dependencies |
| Database | SQLite (WAL, automatic schema creation and migrations) |
| Frontend | Native ES Modules + hand-drawn SVG charts + Canvas cards, no build step |
| Deployment | Single-container Docker / Docker Compose |
| Integrations | REST API, stdio MCP server, PWA, WebDAV |

> No Vue / React / bundler. The goal is one container, no build step and few dependencies. A frontend framework and PostgreSQL can be reconsidered if large multi-user collaboration is ever needed.

## Quick start

### Docker Compose (recommended)

```bash
docker compose up -d --build
```

Open <http://localhost:8080>.

Data lives in the named volume `vehicle-meter-data`:

```bash
docker compose logs -f
docker compose down          # stop, data is kept
```

Optional `.env`:

```dotenv
PORT=8080
APP_PASSWORD=your-password   # empty disables authentication
TZ=Asia/Shanghai
```

When `APP_PASSWORD` is set, the browser shows an HTTP Basic Auth prompt.

### Publish to GitHub / GHCR

The included workflow `.github/workflows/publish-ghcr.yml` uses the built-in `GITHUB_TOKEN` and needs no extra secrets. It builds `linux/amd64` and `linux/arm64` images on every push to `main` and on `v*.*.*` tags.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Images:

```text
ghcr.io/<github-user>/vehicle-meter:latest
ghcr.io/<github-user>/vehicle-meter:main
ghcr.io/<github-user>/vehicle-meter:1.0.0
ghcr.io/<github-user>/vehicle-meter:sha-xxxxxxx
```

For private packages:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

Run from the image:

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

### Local development

Node.js ≥ 22.13 is required (for `node:sqlite`):

```bash
node --version
npm start
```

No `npm install` is needed — the project has no runtime dependencies. The app runs at <http://localhost:8080>; the database is `data/vehicle-meter.sqlite`.

```bash
npm test                     # API / import / backup / MCP / PWA tests
node test/api.test.js        # same, useful in restricted environments
```

### First run

1. Add a vehicle (name, model, energy type, initial odometer).
2. Record the first fuel / charge / parking expense, then create a maintenance plan.
3. On **Reports**, choose a month or year and export a PNG or share card.
4. On **Data**, configure WebDAV or export a full backup.

If there is no data, click **Load demo data**.

## Agent / MCP: official maintenance schedule import

### Workflow

1. The user tells the Agent the vehicle model, e.g. “my car is a 2023 Volkswagen Golf 280TSI”.
2. The Agent calls `list_vehicles` to confirm the vehicle and model/year in Vehicle Meter.
3. The Agent searches the manufacturer's official service schedule (or a page supplied by the user).
4. The Agent prepares plan JSON, previews with `dryRun`, then calls `import_maintenance_plans`.
5. Vehicle Meter upserts by `externalId` (or plan name), stores `sourceUrl`, and shows **Official source** on the plan card.

> The Agent must provide a real source and must not invent intervals. Official schedules are planning references only; actual servicing depends on vehicle condition, the latest manufacturer requirements and workshop inspection.

### Start the MCP server

The MCP server is a zero-dependency stdio JSON-RPC process that calls the running app over HTTP.

**Host (Node)**

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

**Inside Docker**

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

`docker-compose.yml` also injects `APP_PASSWORD` as `VEHICLE_METER_PASSWORD`, so the MCP server inside the container authenticates automatically.

Tools:

| Tool | Purpose |
| --- | --- |
| `list_vehicles` | List vehicles with model, year, current odometer and next service |
| `get_maintenance_plans` | Read existing plans and due status |
| `import_maintenance_plans` | Bulk import with `dryRun`, `deactivateMissing`, `sourceUrl` |
| `create_vehicle` | Create a vehicle when it does not exist yet |

### Direct HTTP API

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
        "notes": "Official schedule: every 10,000 km or 12 months",
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

Full schema and example:

```bash
curl http://localhost:8080/api/agent/maintenance-schema
```

### Idempotency

- `externalId` is unique per vehicle; importing again updates the existing plan.
- Without `externalId`, plans are matched by name.
- A new plan without previous-service data starts its next due date from the current odometer / date, so a fresh import does not immediately turn every item red.
- `deactivateMissing: true` deactivates non-manual plans of that vehicle that were not in this import; useful for a full refresh.

### Agent expense input (no image OCR)

Image recognition is done by the Agent; Vehicle Meter only receives structured JSON:

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
    "station": "Sinopec Caohejing",
    "fuelType": "95#",
    "fullTank": true,
    "externalId": "agent-20261117-001"
  }'
```

`GET /api/agent/schema` returns the field descriptions and JSON Schema. Amount is required; any two of quantity, unit price and amount can derive the third.

## PWA: install on phone / desktop

- `manifest.webmanifest`, 192/512 PNG icons, Apple Touch Icon and a Service Worker are included.
- Android Chrome / Edge: install icon in the address bar, or menu → **Install app**.
- iPhone / iPad: Safari → Share → **Add to Home Screen**.
- Desktop Chrome / Edge: install icon on the right side of the address bar.

**HTTPS requirement**: Service Workers and Chrome's PWA install require a secure context. When accessing `http://192.168.x.x:8080` on a phone, Android installation and offline caching usually do not work. Put an HTTPS reverse proxy (Caddy / Nginx / Traefik) in front for production. iOS **Add to Home Screen** may work over HTTP first.

The install entry is under **Data & Settings → Install on phone / desktop**; a download icon also appears in the top bar when installation is available.

## Data, export and backup

| Feature | Where | Notes |
| --- | --- | --- |
| Excel | Expenses / Data | Vehicles, expenses, maintenance records, plans, monthly summary |
| CSV | Expenses / Data | UTF-8 BOM; “All” exports a ZIP |
| Full backup | Data | JSON with vehicles, expenses, plans, records and settings (including the WebDAV password) |
| Restore | Data | Replaces all current data and preserves IDs |
| WebDAV | Data | Jianguoyun, Nextcloud, Synology; test, backup and restore from remote |

**Jianguoyun**: create an app password under **Account → Security**, use `https://dav.jianguoyun.com/dav/` and the app password, not your login password.

> A full backup contains sensitive settings such as the WebDAV password; do not share it publicly. The WebDAV password is stored in plain text in local SQLite — a deliberate trade-off for a single-user self-hosted app.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Data directory (`/data` in Docker) |
| `DB_PATH` | `$DATA_DIR/vehicle-meter.sqlite` | SQLite file |
| `APP_PASSWORD` | empty | Enables HTTP Basic Auth |
| `TZ` | system time zone | Affects “today” and monthly stats; Compose defaults to `Asia/Shanghai` |
| `MAX_BODY_BYTES` | `31457280` | JSON request body limit |
| `LOG_REQUESTS` | off | Set to `1` to log requests |

## API overview

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check (no auth) |
| GET | `/api/bootstrap` | Vehicles, settings, categories and counts |
| GET/POST | `/api/vehicles` | List / create vehicles |
| PUT/DELETE | `/api/vehicles/:id` | Update / archive (`?hard=1` to delete permanently) |
| GET/POST | `/api/expenses` | List / create expenses |
| PUT/DELETE | `/api/expenses/:id` | Update / delete |
| GET/POST | `/api/plans` | Maintenance plans with due status / create |
| PUT/DELETE | `/api/plans/:id` | Update / delete |
| GET/POST | `/api/maintenance` | Service records / create |
| GET | `/api/stats/dashboard` | Dashboard stats |
| GET | `/api/stats/energy` | Energy stats |
| GET | `/api/reports` | Monthly / yearly / all-time / custom report |
| GET | `/api/card` | Share-card data (last 3 months by default) |
| POST | `/api/agent/expenses` | Agent expense input (idempotent) |
| POST | `/api/agent/maintenance-plans` | Agent bulk plan import |
| GET | `/api/agent/schema` | Expense schema |
| GET | `/api/agent/maintenance-schema` | Maintenance import schema |
| GET | `/api/export/xlsx` | Excel export |
| GET | `/api/export/csv?kind=all` | CSV / ZIP export |
| GET/POST | `/api/backup`, `/api/restore` | Full backup / restore |
| GET/PUT | `/api/settings` | Settings (WebDAV password is never returned) |
| POST | `/api/webdav/test`, `backup`, `restore` | WebDAV actions |

## Project layout

```text
.
├── server.js               # HTTP server, static files, auth
├── src/
│   ├── api.js              # REST routes, agent input, import/export
│   ├── db.js               # SQLite schema / migrations
│   ├── stats.js            # fuel, energy, reports, card data
│   ├── xlsx.js             # native XLSX / ZIP writer
│   ├── webdav.js           # WebDAV client
│   ├── demo.js             # demo data
│   └── util.js             # dates, validation, CSV
├── mcp/server.js           # stdio MCP server (no dependencies)
├── public/
│   ├── index.html
│   ├── css/app.css         # layout and responsive rules
│   ├── css/notion.css      # Notion-inspired skin
│   ├── js/                 # SPA, charts, Canvas cards, PWA
│   ├── icons/              # PWA icons
│   ├── manifest.webmanifest
│   └── sw.js               # Service Worker
├── scripts/make-icons.mjs  # regenerate PWA icons
├── test/api.test.js
├── Dockerfile
└── docker-compose.yml
```

## Calculation rules

- **Fuel consumption**: full-tank method by default. Fuel added between two full fills ÷ odometer difference × 100, in L/100km.
- **EV consumption**: between two charge records, charge energy ÷ distance × 100, in kWh/100km.
- **Mileage**: odometer readings from expenses and maintenance plus the vehicle's initial odometer; the nearest reading is used when an endpoint has no reading.
- **Cost**: daily expenses + maintenance record costs; cost per km = total cost ÷ range distance.
- **Maintenance due**: an explicit next-due value wins; otherwise last service / purchase date + interval. The warning threshold is 30 days / 500 km by default.
- **Share card**: last-3-month average fuel / EV consumption, mileage, total cost, cost per km, current odometer, next service and last 4 months of spending.

## Security and limitations

- Single-user, single-instance design. SQLite suits personal / family data, not concurrent multi-instance writes.
- No login by default. Always set `APP_PASSWORD` and HTTPS when exposed to the internet.
- No built-in TLS. Use Caddy / Nginx / Traefik as a reverse proxy.
- The WebDAV password is stored in plain text in SQLite and included in full backups.
- Official maintenance data is fetched and written by the Agent; the app bundles no manufacturer manuals and does not guarantee third-party accuracy.
- Image recognition is not handled by the app: the Agent reads the image and sends structured JSON.

## Development notes

- Edit `public/` directly and refresh; static assets use `no-cache` + ETag.
- Database migrations live in `src/db.js`, currently schema version 2; new columns are added with `ALTER TABLE`.
- Share card and report images live in `public/js/sharecard.js` and use native Canvas.
- Regenerate icons:

```bash
node scripts/make-icons.mjs
```

- After frontend changes, bump the `CACHE` version in `public/sw.js` so installed PWAs pick up the new cache.

## License

Personal project, no specific open-source license. Check third-party data and manufacturer manual copyrights before use.
