# Vehicle Meter · 车记

[中文](README.md) · [English](README.en.md) · **Français** · [Español](README.es.md)

Une application de gestion de véhicule locale. Un conteneur Docker et un fichier SQLite pour les dépenses, l'énergie, l'entretien, les rapports, plusieurs véhicules, la sauvegarde WebDAV et l'installation PWA.

L'interface s'inspire de Notion : barre latérale gris clair, fond blanc, bordures fines et typographie sobre.

## Fonctionnalités

- **Dépenses** : carburant, recharge, stationnement, péages, assurance, réparation, lavage et autres ; répartition par catégorie, tendance mensuelle et coût au kilomètre.
- **Analyse énergétique** : consommation de carburant par la méthode du plein à plein, consommation électrique entre deux recharges, prix unitaire de l'énergie et coût énergétique aux 100 km.
- **Entretien** : intervalles en kilomètres et en mois, rappels d'échéance, historique et liens vers la source officielle.
- **Rapports** : mensuel, annuel, cumulé et personnalisé ; export PNG haute résolution ; carte de partage en un geste (Twitter / X 1200×630).
- **Plusieurs véhicules** : dépenses, énergie, entretien et rapports indépendants par véhicule.
- **Données** : Excel, CSV (ZIP), sauvegarde / restauration JSON complète et synchronisation WebDAV (Jianguoyun, Nextcloud, Synology, etc.).
- **PWA** : installation sur l'écran d'accueil d'un téléphone ou sur le bureau, exécution plein écran et coque hors ligne via Service Worker.
- **Intégration Agent** :
  - API de saisie structurée des dépenses (l'Agent lit le reçu et envoie du JSON ; le backend ne fait pas d'OCR d'image).
  - **Import groupé des plans d'entretien via MCP** : indiquez le modèle à l'Agent, il consulte le carnet d'entretien officiel et importe les plans par MCP.

## Pile technique

| Couche | Choix |
| --- | --- |
| Runtime | Node.js ≥ 22.13 (Node 24 Alpine dans Docker) |
| Backend | `http` natif + `node:sqlite` intégré, aucune dépendance d'exécution |
| Base de données | SQLite (WAL, création et migrations automatiques du schéma) |
| Frontend | ES Modules natifs + graphiques SVG dessinés à la main + cartes Canvas, sans étape de build |
| Déploiement | Docker / Docker Compose mono-conteneur |
| Intégrations | API REST, serveur MCP stdio, PWA, WebDAV |

> Pas de Vue / React / bundler. L'objectif est un seul conteneur, sans build et avec peu de dépendances. Un framework frontend et PostgreSQL pourront être envisagés si une collaboration multi-utilisateurs à grande échelle devient nécessaire.

## Démarrage rapide

### Docker Compose (recommandé)

```bash
docker compose up -d --build
```

Ouvrez <http://localhost:8080>.

Les données sont conservées dans le volume nommé `vehicle-meter-data` :

```bash
docker compose logs -f
docker compose down          # arrêt, données conservées
```

`.env` facultatif :

```dotenv
PORT=8080
APP_PASSWORD=votre-mot-de-passe   # vide = pas d'authentification
TZ=Asia/Shanghai
```

Si `APP_PASSWORD` est défini, le navigateur affiche une authentification HTTP Basic.

### Publication sur GitHub / GHCR

Le workflow `.github/workflows/publish-ghcr.yml` utilise le `GITHUB_TOKEN` intégré et ne nécessite aucun secret supplémentaire. Il construit les images `linux/amd64` et `linux/arm64` à chaque push sur `main` et sur les tags `v*.*.*`.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Images :

```text
ghcr.io/<utilisateur-github>/vehicle-meter:latest
ghcr.io/<utilisateur-github>/vehicle-meter:main
ghcr.io/<utilisateur-github>/vehicle-meter:1.0.0
ghcr.io/<utilisateur-github>/vehicle-meter:sha-xxxxxxx
```

Pour un paquet privé :

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <utilisateur-github> --password-stdin
```

Lancer depuis l'image :

```yaml
services:
  vehicle-meter:
    image: ghcr.io/<utilisateur-github>/vehicle-meter:latest
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

### Développement local

Node.js ≥ 22.13 est requis (pour `node:sqlite`) :

```bash
node --version
npm start
```

Aucun `npm install` n'est nécessaire : le projet n'a pas de dépendance d'exécution. L'application écoute sur <http://localhost:8080> et la base se trouve dans `data/vehicle-meter.sqlite`.

```bash
npm test                     # tests API / import / sauvegarde / MCP / PWA
node test/api.test.js        # identique, utile en environnement restreint
```

### Premier lancement

1. Ajoutez un véhicule (nom, modèle, type d'énergie, kilométrage initial).
2. Enregistrez la première dépense de carburant / recharge / stationnement, puis créez un plan d'entretien.
3. Dans **Rapports**, choisissez un mois ou une année, puis exportez un PNG ou une carte de partage.
4. Dans **Données**, configurez WebDAV ou exportez une sauvegarde complète.

S'il n'y a aucune donnée, cliquez sur **Charger les données de démonstration**.

## Agent / MCP : import du carnet d'entretien officiel

### Déroulement

1. L'utilisateur indique le modèle à l'Agent, par exemple « ma voiture est une Volkswagen Golf 280TSI de 2023 ».
2. L'Agent appelle `list_vehicles` pour confirmer le véhicule et le modèle / l'année dans Vehicle Meter.
3. L'Agent recherche le carnet d'entretien officiel du constructeur (ou une page fournie par l'utilisateur).
4. L'Agent prépare le JSON des plans, fait un `dryRun`, puis appelle `import_maintenance_plans`.
5. Vehicle Meter fait un upsert par `externalId` (ou par nom), conserve `sourceUrl` et affiche **Source officielle** sur la carte du plan.

> L'Agent doit fournir une source réelle et ne doit pas inventer les intervalles. Les recommandations officielles servent uniquement de référence ; l'entretien réel dépend de l'état du véhicule, des dernières exigences du constructeur et du contrôle en atelier.

### Démarrer le serveur MCP

Le serveur MCP est un processus stdio JSON-RPC sans dépendance qui appelle l'application en HTTP.

**Hôte (Node)**

```json
{
  "mcpServers": {
    "vehicle-meter": {
      "command": "node",
      "args": ["/chemin/absolu/vers/vehicle-meter/mcp/server.js"],
      "env": {
        "VEHICLE_METER_URL": "http://127.0.0.1:8080",
        "VEHICLE_METER_PASSWORD": ""
      }
    }
  }
}
```

**Dans Docker**

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

`docker-compose.yml` injecte aussi `APP_PASSWORD` sous le nom `VEHICLE_METER_PASSWORD`, ce qui permet au serveur MCP du conteneur de s'authentifier automatiquement.

Outils :

| Outil | Rôle |
| --- | --- |
| `list_vehicles` | Liste les véhicules avec modèle, année, kilométrage et prochain entretien |
| `get_maintenance_plans` | Lit les plans existants et leur échéance |
| `import_maintenance_plans` | Import groupé avec `dryRun`, `deactivateMissing`, `sourceUrl` |
| `create_vehicle` | Crée le véhicule s'il n'existe pas encore |

### Appel direct de l'API HTTP

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
        "notes": "Carnet officiel : tous les 10 000 km ou 12 mois",
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

Schéma complet et exemple :

```bash
curl http://localhost:8080/api/agent/maintenance-schema
```

### Idempotence

- `externalId` est unique par véhicule ; un nouvel import met à jour le plan existant.
- Sans `externalId`, les plans sont rapprochés par nom.
- Un nouveau plan sans données d'entretien précédentes calcule sa prochaine échéance à partir du kilométrage / de la date actuels, afin qu'un import ne passe pas immédiatement tout en rouge.
- `deactivateMissing: true` désactive les plans non manuels du véhicule absents de cet import ; utile pour une actualisation complète.

### Saisie des dépenses par l'Agent (sans OCR d'image)

La reconnaissance d'image est faite par l'Agent ; Vehicle Meter reçoit uniquement du JSON structuré :

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

`GET /api/agent/schema` renvoie la description des champs et le JSON Schema. Le montant est obligatoire ; deux valeurs parmi quantité, prix unitaire et montant suffisent à déduire la troisième.

## PWA : installer sur téléphone / bureau

- `manifest.webmanifest`, icônes PNG 192/512, Apple Touch Icon et Service Worker sont inclus.
- Android Chrome / Edge : icône d'installation dans la barre d'adresse, ou menu → **Installer l'application**.
- iPhone / iPad : Safari → Partager → **Sur l'écran d'accueil**.
- Chrome / Edge sur bureau : icône d'installation à droite de la barre d'adresse.

**Exigence HTTPS** : les Service Workers et l'installation PWA de Chrome nécessitent un contexte sécurisé. En accédant à `http://192.168.x.x:8080` depuis un téléphone, l'installation Android et le cache hors ligne ne fonctionnent généralement pas. Placez un reverse proxy HTTPS (Caddy / Nginx / Traefik) devant le conteneur en production. Sur iOS, **Sur l'écran d'accueil** peut fonctionner d'abord en HTTP.

L'entrée d'installation se trouve dans **Données et réglages → Installer sur téléphone / bureau** ; une icône de téléchargement apparaît aussi dans la barre supérieure lorsque l'installation est disponible.

## Données, export et sauvegarde

| Fonction | Emplacement | Détails |
| --- | --- | --- |
| Excel | Dépenses / Données | Véhicules, dépenses, entretiens, plans, synthèse mensuelle |
| CSV | Dépenses / Données | BOM UTF-8 ; « Tout » exporte un ZIP |
| Sauvegarde complète | Données | JSON avec véhicules, dépenses, plans, entretiens et réglages (mot de passe WebDAV inclus) |
| Restauration | Données | Remplace toutes les données et conserve les ID |
| WebDAV | Données | Jianguoyun, Nextcloud, Synology ; test, sauvegarde et restauration distante |

**Jianguoyun** : créez un mot de passe d'application dans **Compte → Sécurité**, utilisez `https://dav.jianguoyun.com/dav/` et ce mot de passe, pas celui de connexion.

> Une sauvegarde complète contient des réglages sensibles comme le mot de passe WebDAV ; ne la partagez pas. Le mot de passe WebDAV est stocké en clair dans SQLite, un compromis assumé pour une application auto-hébergée mono-utilisateur.

## Configuration

| Variable | Valeur par défaut | Description |
| --- | --- | --- |
| `PORT` | `8080` | Port d'écoute |
| `HOST` | `0.0.0.0` | Adresse d'écoute |
| `DATA_DIR` | `./data` | Répertoire des données (`/data` dans Docker) |
| `DB_PATH` | `$DATA_DIR/vehicle-meter.sqlite` | Fichier SQLite |
| `APP_PASSWORD` | vide | Active l'authentification HTTP Basic |
| `TZ` | fuseau du système | Affecte « aujourd'hui » et les statistiques mensuelles ; Compose utilise `Asia/Shanghai` |
| `MAX_BODY_BYTES` | `31457280` | Limite du corps JSON |
| `LOG_REQUESTS` | désactivé | `1` pour journaliser les requêtes |

## Aperçu de l'API

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/api/health` | Contrôle de santé (sans authentification) |
| GET | `/api/bootstrap` | Véhicules, réglages, catégories et compteurs |
| GET/POST | `/api/vehicles` | Liste / création de véhicules |
| PUT/DELETE | `/api/vehicles/:id` | Modification / archivage (`?hard=1` pour supprimer) |
| GET/POST | `/api/expenses` | Liste / création de dépenses |
| PUT/DELETE | `/api/expenses/:id` | Modification / suppression |
| GET/POST | `/api/plans` | Plans d'entretien avec échéance / création |
| PUT/DELETE | `/api/plans/:id` | Modification / suppression |
| GET/POST | `/api/maintenance` | Historique d'entretien / création |
| GET | `/api/stats/dashboard` | Statistiques du tableau de bord |
| GET | `/api/stats/energy` | Statistiques énergétiques |
| GET | `/api/reports` | Rapport mensuel / annuel / cumulé / personnalisé |
| GET | `/api/card` | Données de la carte de partage (3 derniers mois par défaut) |
| POST | `/api/agent/expenses` | Saisie de dépense par l'Agent (idempotente) |
| POST | `/api/agent/maintenance-plans` | Import groupé des plans par l'Agent |
| GET | `/api/agent/schema` | Schéma des dépenses |
| GET | `/api/agent/maintenance-schema` | Schéma d'import des plans |
| GET | `/api/export/xlsx` | Export Excel |
| GET | `/api/export/csv?kind=all` | Export CSV / ZIP |
| GET/POST | `/api/backup`, `/api/restore` | Sauvegarde / restauration complète |
| GET/PUT | `/api/settings` | Réglages (le mot de passe WebDAV n'est jamais renvoyé) |
| POST | `/api/webdav/test`, `backup`, `restore` | Actions WebDAV |

## Arborescence

```text
.
├── server.js               # serveur HTTP, fichiers statiques, authentification
├── src/
│   ├── api.js              # routes REST, saisie Agent, import/export
│   ├── db.js               # schéma SQLite / migrations
│   ├── stats.js            # carburant, énergie, rapports, carte
│   ├── xlsx.js             # génération XLSX / ZIP native
│   ├── webdav.js           # client WebDAV
│   ├── demo.js             # données de démonstration
│   └── util.js             # dates, validation, CSV
├── mcp/server.js           # serveur MCP stdio (sans dépendance)
├── public/
│   ├── index.html
│   ├── css/app.css         # mise en page et responsive
│   ├── css/notion.css      # habillage inspiré de Notion
│   ├── js/                 # SPA, graphiques, cartes Canvas, PWA
│   ├── icons/              # icônes PWA
│   ├── manifest.webmanifest
│   └── sw.js               # Service Worker
├── scripts/make-icons.mjs  # régénérer les icônes PWA
├── test/api.test.js
├── Dockerfile
└── docker-compose.yml
```

## Règles de calcul

- **Consommation de carburant** : méthode du plein à plein par défaut. Carburant ajouté entre deux pleins ÷ différence de kilométrage × 100, en L/100 km.
- **Consommation électrique** : entre deux recharges, énergie chargée ÷ distance × 100, en kWh/100 km.
- **Kilométrage** : relevés des dépenses et entretiens plus le kilométrage initial ; le relevé le plus proche sert d'estimation aux extrémités.
- **Coût** : dépenses courantes + coûts d'entretien ; coût au km = coût total ÷ distance de la période.
- **Échéance d'entretien** : une échéance explicite est prioritaire ; sinon dernière intervention / date d'achat + intervalle. Seuil d'alerte par défaut : 30 jours / 500 km.
- **Carte de partage** : consommation moyenne des 3 derniers mois, kilométrage, dépense totale, coût au km, kilométrage actuel, prochain entretien et dépenses des 4 derniers mois.

## Sécurité et limites

- Conception mono-utilisateur et mono-instance. SQLite convient aux données personnelles / familiales, pas aux écritures concurrentes multi-instances.
- Aucune authentification par défaut. Définissez toujours `APP_PASSWORD` et HTTPS en exposition Internet.
- Pas de TLS intégré. Utilisez Caddy / Nginx / Traefik comme reverse proxy.
- Le mot de passe WebDAV est stocké en clair dans SQLite et inclus dans les sauvegardes complètes.
- Les données d'entretien officielles sont récupérées et écrites par l'Agent ; l'application ne fournit aucun carnet constructeur et ne garantit pas l'exactitude des données tierces.
- La reconnaissance d'image n'est pas assurée par l'application : l'Agent lit l'image et envoie du JSON structuré.

## Développement

- Modifiez `public/` et rafraîchissez ; les fichiers statiques utilisent `no-cache` + ETag.
- Les migrations sont dans `src/db.js`, schéma actuel version 2 ; les nouvelles colonnes sont ajoutées par `ALTER TABLE`.
- La carte de partage et les rapports sont dans `public/js/sharecard.js`, en Canvas natif.
- Régénérer les icônes :

```bash
node scripts/make-icons.mjs
```

- Après une modification frontend, incrémentez la version `CACHE` dans `public/sw.js` pour que les PWA installées récupèrent le nouveau cache.

## Licence

Projet personnel, sans licence open source spécifique. Vérifiez les droits des données tierces et des carnets constructeur avant utilisation.
