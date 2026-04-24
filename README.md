# hallakompis

Goberg sin personlige AI-assistent "Kompis". Monorepo med Next.js-frontend, Fastify-backend, PostgreSQL + pgvector, Redis, Claude som orkestrator.

```
hallakompis/
├── apps/
│   ├── web/         Next.js 15 (App Router) — brukergrensesnitt
│   └── api/         Fastify — REST + chat-orkestrator
├── packages/
│   ├── db/          Drizzle ORM + skjema + seed
│   └── shared/      Zod-typer delt mellom web og api
├── docker-compose.yml   Lokal Postgres (med pgvector) + Redis
└── DEPLOY-NORTHFLANK.md Produksjons-deploy
```

---

## Kom i gang (lokalt)

### 1. Forutsetninger

- **Node.js 20+** (`node -v` for å sjekke)
- **pnpm 9+** — installer med `npm i -g pnpm`
- **Docker** (for Postgres + Redis lokalt) — Docker Desktop på Mac/Windows

### 2. Klone + installer

```bash
git clone <ditt-repo> hallakompis
cd hallakompis
pnpm install
```

### 3. Miljøvariabler

```bash
cp .env.example .env
```

Åpne `.env` og legg inn:

```
ANTHROPIC_API_KEY=sk-ant-...
SESSION_SECRET=<kjør: openssl rand -hex 32>
```

Google OAuth og Slack kan vente til vi legger til de integrasjonene.

### 4. Start databasen

```bash
pnpm docker:up
```

Dette starter Postgres (med pgvector forhåndsinstallert) og Redis i bakgrunnen. Logger: `pnpm docker:logs`.

### 5. Opprett skjemaet + seed

```bash
pnpm db:push        # Oppretter alle tabellene
pnpm db:seed        # Legger inn familien Goberg som testdata
```

Seed-scriptet oppretter:
- Husstand: "Familien Goberg"
- Brukere: Goberg, Ida, Emma, Noah, Olivia
- Noen testoppgaver og handleliste-varer

Du kan inspisere dataene med `pnpm db:studio` (åpner Drizzle Studio i nettleseren).

### 6. Start web + api

I to separate terminaler:

```bash
# Terminal 1 — API på port 3001
pnpm --filter @hallakompis/api dev

# Terminal 2 — Web på port 3000
pnpm --filter @hallakompis/web dev
```

Eller begge samtidig:

```bash
pnpm dev
```

### 7. Åpne appen

http://localhost:3000 → velg "Goberg" → du er inne.

Chat med Kompis i høyre panel: "Legg til kaffe og havregryn på handlelisten" → watch it work.

---

## Arkitektur på høyt nivå

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                     │
│    Login + Portal + Chat-panel                          │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP + cookies
┌──────────────────▼──────────────────────────────────────┐
│  API (Fastify)                                          │
│    Auth · Tasks · Shopping · Layout · Chat              │
│                                                         │
│  Chat-orkestrator (Claude opus-4.7)                     │
│    ├─ read_calendar, add_to_shopping, add_task, ...     │
│    └─ Agent-løkke med tool-use                          │
└──────┬──────────────────────────────┬────────────────────┘
       │                              │
┌──────▼─────┐                  ┌─────▼──────┐
│  Postgres  │                  │   Redis    │
│  + pgvector│                  │   (cache)  │
└────────────┘                  └────────────┘
```

### Verktøy-registeret (chat ↔ moduler)

Når Kompis får en melding, har den tilgang til verktøy som er definert i `apps/api/src/chat/tools.ts`. Legg til et nytt verktøy ved å:

1. Definere input-schema med Zod
2. Skrive `execute`-funksjonen (bruk `db` fra `@hallakompis/db`)
3. Legge det inn i `toolRegistry`

Kompis ser det nye verktøyet automatisk og velger når det skal brukes.

---

## Produksjon: deploy til Northflank

```bash
# 1. Installer CLI
npm i -g @northflank/cli
northflank login

# 2. Sett opp hemmeligheter
northflank create secret anthropic-api-key --value "sk-ant-..."
northflank create secret session-secret --value "$(openssl rand -hex 32)"

# 3. Koble til GitHub-repo, push til main
git push origin main

# 4. Deploy fra manifestet
northflank apply -f northflank.yaml
```

Northflank vil:
- Opprette Postgres (med pgvector ferdig installert)
- Opprette Redis
- Bygge `kompis-web` og `kompis-api` fra hver sin Dockerfile
- Kjøre `kompis-sync-worker` som long-running job
- Kjøre `kompis-learning` som nattlig cron (kl. 03)

Hver pull request får automatisk eget preview-miljø med isolert database.

---

## Kommando-referanse

```bash
pnpm dev                    # Kjør web + api samtidig
pnpm build                  # Bygg alt
pnpm typecheck              # Sjekk typer
pnpm docker:up              # Start Postgres + Redis
pnpm docker:down            # Stopp dem
pnpm docker:logs            # Se logger
pnpm db:generate            # Lag migrasjon fra skjemaet
pnpm db:push                # Push skjema direkte (dev)
pnpm db:seed                # Seed med familien Goberg
pnpm db:studio              # Visuell DB-utforsker
```

---

## Byggerekkefølge (roadmap)

**Uke 1 — Fundamentet (nå)** ✅
- Login, portal, oppgaver, handleliste, chat med basic verktøy

**Uke 2–3 — Google Calendar-integrasjon**
- OAuth-flow + sync-worker + "I dag"-tidslinjen med ekte data
- Legg til `create_event`-verktøy

**Uke 4–5 — Gmail + meldinger**
- Gmail OAuth + sammenfatning
- Slack Socket Mode-integrasjon
- `summarize_inbox`, `draft_reply`

**Uke 6–7 — Barna**
- Spond-scraper (Playwright)
- Skolemeldinger-scraper
- Barna-kort, veggvisning for iPad

**Uke 8–9 — Matoppskrifter**
- Scrape fra matprat.no, godt.no, NRK Mat
- Embedding + "Overrask meg"-algoritmen

**Uke 10+ — Avansert**
- Farmer's Wife via Vision AI
- Messenger (Playwright)
- ElevenLabs norsk TTS
- Proaktive varsler

---

## Struktur for samarbeid mellom Goberg og Claude (meg)

Når du jobber med meg i Claude:
1. Si hva du vil bygge videre på (f.eks. "legg til Google Calendar-integrasjonen")
2. Jeg genererer/endrer filer direkte i dette repoet
3. Du committer og pusher
4. CI kjører, preview-miljø bygges på Northflank

Struktur jeg kan holde i hodet om ting:
- Alle endringer bør passe inn i Drizzle-skjemaet
- Nye integrasjoner går i `packages/integrations/<navn>/`
- Nye Kompis-verktøy legges i `apps/api/src/chat/tools.ts`
- Ikke berør `audit_log` — alle handlinger som sideeffekter skal logges der

---

## Lisens

Privat. Dette er Goberg sin.
