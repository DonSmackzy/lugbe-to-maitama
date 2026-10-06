# 🏙️ Lugbe to Maitama

> **A viral, browser-based, multiplayer 2D isometric socio-economic survival game set in Abuja, Nigeria.**
> Survive the satellite grit of Lugbe. Hustle the civil service of Garki. Rise to the diplomatic mansions of Maitama and the apex perimeter of Aso Rock Villa.

---

> [!IMPORTANT]
> **STATUTORY SATIRE DISCLAIMER:**  
> *Lugbe to Maitama is a work of fiction and satire. All names, characters, businesses, places, events, and incidents are either the products of the creator's imagination or used in a fictitious manner. Any resemblance to actual persons (living or dead), including the 'President' or any government officials, is purely coincidental.*

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Client["Browser Client (apps/web)"]
        UI["DOM HUD Overlay\n(pointer-events: none)"]
        PhaserCanvas["Phaser 3 Isometric Canvas\n(30 FPS, Viewport Culled, Y-Sorted)"]
        PredictionMgr["PredictionManager\n(Sequence-Based Reconciliation)"]
        ColyseusClient["Colyseus Game Client\n(Verified Disclaimer Auth)"]
    end

    subgraph Server["Authoritative Game Server (apps/server)"]
        WorldRoom["Colyseus WorldRoom\n(Authoritative Memory State)"]
        PlayerQueue["PlayerSerialQueue\n(FIFO Mutex per Account)"]
        Ledger["Append-Only Ledger\n(Atomic Spatial & Financial Sync)"]
        Deadlock["Deadlock Prevention\n(Alphabetical Row Locks)"]
    end

    subgraph AIService["AI Dialogue Microservice (apps/ai-service)"]
        FastifyApp["Fastify HTTP Server\n(POST /dialogue)"]
        StampedeCache["InflightDeduplicator\n(Anti-Stampede Map Lock)"]
        LLM["OpenAI Wrapper\n(1500ms AbortController SLA)"]
    end

    subgraph DataTier["Data & Infrastructure"]
        Postgres[(PostgreSQL 16\nAppend-Only Ledger & Idempotency)]
        Redis[(Redis 7\nPresence, Snapshots & Cache)]
    end

    subgraph PureEngine["Decoupled Simulation Engine (packages/engine)"]
        Engine["resolve() / advance()\n(AST Evaluator, Zero I/O)"]
        CityPack["city-packs/abuja\n(Declarative Rules JSON)"]
    end

    ColyseusClient -- "WebSocket (Intents with seq & idemKey)" --> WorldRoom
    WorldRoom -- "Authoritative State Sync & ACKs" --> ColyseusClient
    WorldRoom --> PlayerQueue
    PlayerQueue --> Engine
    Engine -. Evaluates .- CityPack
    PlayerQueue --> Ledger
    Ledger --> Deadlock --> Postgres
    WorldRoom -- "Rate Limits & Snapshots" --> Redis
    WorldRoom -- "HTTP (x-internal-key)" --> FastifyApp
    FastifyApp --> StampedeCache --> Redis
    StampedeCache -- "Cache Miss (Single Flight)" --> LLM
```

---

## 🔒 Core Architectural Invariants

| Principle | Technical Enforcement |
|:---|:---|
| **Money = Integer Kobo** | Every balance mutation is measured in integer kobo (`BIGINT` in PostgreSQL). The engine mathematically forbids floating-point representations. |
| **Engine Decoupling** | [`packages/engine`](file:///c:/Users/BOSS_MEZIE/Documents/Abuja%20Connect/packages/engine) contains **zero** imports from `apps/*`, `fs`, `window`, or DOM. It receives a validated `CityPack` at runtime. |
| **State Authority** | Colyseus owns authoritative room state in process memory. Redis is reserved strictly for presence, matchmaking, and crash-recovery snapshots. |
| **The Append-Only Ledger** | Every financial transaction writes an immutable entry into PostgreSQL `ledger_entries` paired with an `idem_key`. |
| **Atomic Spatial/Financial Sync** | Paid commutes commit both the financial deduction and the player's updated coordinates (`pos_x`, `pos_y`, `district_id`) in the **exact same Postgres transaction**, eliminating desyncs. |
| **Deadlock Prevention** | Multi-row database operations strictly sort all `player_id`s alphabetically and acquire row-level locks via `SELECT ... FOR UPDATE` sequentially. |
| **Inventory Zero-State Pruning** | Pruning negative item changes runs a distinct subsequent `DELETE FROM inventory WHERE quantity <= 0 AND player_id = $1` query within the transaction. |
| **Anti-Stampede AI Caching** | An in-memory promise lock (`InflightDeduplicator`) coalesces concurrent identical requests into a single upstream LLM call with a 6-hour Redis TTL (`EX 21600`). |
| **Strict 1500ms AI SLA** | LLM calls are bounded by an `AbortController` timeout (1500ms). Failures cleanly return pre-authored City Pack fallback lines without crashing. |
| **Unbypassable Satire Disclaimer** | Colyseus `onAuth` and `onJoin` hooks enforce verified disclaimer acceptance payloads (`disclaimerAccepted: true`), strictly terminating console bypass attempts. |
| **Anti-XSS Dialogue Safety** | Dialogue text rendered via the DOM HUD is injected strictly through `element.textContent`, preventing AI-hallucinated script injection. |
| **Rubber-Banding Defense** | Sequence-based reconciliation (`PredictionManager`) snaps local state to authoritative server ACKs and re-simulates in-flight intents, ensuring smooth 30FPS client movement against a 10Hz server tick. |

---

## 📁 Repository Structure

```
lugbe-to-maitama/
├── apps/
│   ├── web/               # Vite + Phaser 3 isometric client & DOM HUD
│   ├── server/            # Colyseus authoritative server & PostgreSQL ledger
│   └── ai-service/        # Fastify microservice with anti-stampede tiered LLM
├── packages/
│   ├── engine/            # Pure TypeScript simulation engine & AST evaluator
│   ├── city-schema/       # Zod schemas validating City Packs
│   ├── protocol/          # Shared type-safe intent & message contracts
│   └── db/                # PostgreSQL migrations & database client
├── city-packs/
│   └── abuja/             # Abuja City Pack (v1.0.0 declarative data)
├── Dockerfile.server      # Multi-stage production container for game server
├── Dockerfile.ai          # Multi-stage production container for AI service
├── docker-compose.yml     # Local PostgreSQL & Redis infrastructure
├── turbo.json             # Turborepo task pipeline configuration
└── pnpm-workspace.yaml    # Monorepo package workspace definitions
```

---

## 🚀 Local Development Setup

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **pnpm**: `v9.0.0` or higher
- **Docker & Docker Compose**: For local PostgreSQL and Redis

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-org/lugbe-to-maitama.git
cd lugbe-to-maitama
pnpm install
```

### 2. Start Local Infrastructure
Start PostgreSQL (port `5432`) and Redis (port `6379`):
```bash
docker compose up -d
```

### 3. Configure Environment Variables
Copy the reference environment configuration:
```bash
cp .env.example .env
```
*(Optionally populate `OPENAI_API_KEY` for live AI dialogue generation; the service automatically operates in offline fallback mode if omitted).*

### 4. Execute Database Migrations
Run the append-only ledger migrations:
```bash
pnpm db:migrate
```

### 5. Launch Development Services
Start all monorepo workspaces concurrently via Turborepo:
```bash
pnpm dev
```

| Service | Protocol / Port | Purpose |
|:---|:---|:---|
| **Web Client** | `http://localhost:5173` | Phaser 3 Isometric Game & Onboarding |
| **Colyseus Server** | `ws://localhost:2567` | Authoritative Room & State Synchronization |
| **Fastify AI Service** | `http://localhost:3001` | NPC Dialogue Microservice & Healthcheck |
| **Colyseus Monitor** | `http://localhost:2567/colyseus` | Live Room State Debugger |

---

## 🧪 Testing & Verification

The test suite consists of **50 comprehensive unit and integration specs** across all monorepo packages.

Run all tests via Turborepo:
```bash
pnpm test
```

### Test Suite Breakdown:
- **`packages/engine` (12 specs):**
  - Cash invariant protection & rollback on insufficient funds
  - Idempotency key rejection (`idem_key` deduplication)
  - 20 concurrent purchase balance integrity
  - Commuter Tax declarative AST evaluation on satellite residents
  - NavGrid boundary collision & blocked tile validations
- **`apps/server` (17 specs):**
  - FIFO sequential queue execution per player (`PlayerSerialQueue`)
  - Parallel cross-player non-blocking execution
  - Append-only ledger debit/credit recording
  - Sliding-window Redis token bucket rate limiting
  - Unbypassable satire disclaimer network rejection
  - Atomic spatial and financial transaction synchronization (Commute patch)
  - Deterministic alphabetical row locking (Deadlock prevention)
  - Immediate pruning of `quantity <= 0` inventory records
- **`apps/ai-service` (13 specs):**
  - Fastify `x-internal-key` header authentication
  - 50 concurrent request stampede deduplication (Single-flight LLM call)
  - 1500ms `AbortController` timeout enforcement
  - Fallback dialogue preservation
  - Persona prompt generators (Head of State, Civil Servant, Driver)
  - Output constraints: max 280 characters, no emojis
- **`apps/web` (8 specs):**
  - Input prediction with sequence incrementing
  - Authoritative ACK reconciliation without rubber-banding
  - 2:1 isometric projection forward & inverse mathematical accuracy
  - Strict depth sorting (`calculateDepth`)
  - Anti-XSS dialogue safety (`textContent` verification)

---

## 🚢 Production Deployment

### 1. Monorepo Build Pipeline
Compile all workspaces and bundle the web client:
```bash
pnpm build
```

### 2. Building Production Docker Containers

#### Game Server Container:
```bash
docker build -f Dockerfile.server -t lugbe-to-maitama-server:latest .
```

#### AI Dialogue Microservice Container:
```bash
docker build -f Dockerfile.ai -t lugbe-to-maitama-ai:latest .
```

### 3. Container Execution
Run containers in production with your managed PostgreSQL and Redis instances:
```bash
# Start Game Server
docker run -d \
  --name ltm-server \
  -p 2567:2567 \
  -e DATABASE_URL="postgresql://user:pass@db-host:5432/ltm_prod" \
  -e REDIS_URL="redis://:pass@redis-host:6379" \
  -e AI_SERVICE_URL="http://ai-service-internal:3001" \
  -e AI_INTERNAL_KEY="your-production-internal-key" \
  lugbe-to-maitama-server:latest

# Start AI Microservice
docker run -d \
  --name ltm-ai \
  -p 3001:3001 \
  -e INTERNAL_KEY="your-production-internal-key" \
  -e OPENAI_API_KEY="sk-prod-your-openai-key" \
  -e REDIS_URL="redis://:pass@redis-host:6379" \
  lugbe-to-maitama-ai:latest
```

---

## 📄 License
Private & Proprietary. All rights reserved.
