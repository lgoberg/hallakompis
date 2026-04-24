# Deploy til Northflank

Dette er den faktiske prosedyren for å få Kompis opp på Northflank. Alt gjøres via dashbordet på https://app.northflank.com.

## Før du starter

- Kjøres lokalt først (se README) så du vet at alt fungerer
- Push koden til et privat GitHub-repo
- Ha `ANTHROPIC_API_KEY` klar
- Kjør `openssl rand -hex 32` for en `SESSION_SECRET` du noterer ned

## Steg 1 — Opprett Northflank-konto og koble GitHub

1. Gå til northflank.com → Sign up
2. Settings → Git → Connect GitHub → autoriser tilgang til Kompis-repoet

## Steg 2 — Opprett prosjekt

1. **New project** → kall det `kompis`
2. Region: **europe-west** (nærmest Norge)
3. Color: hvilken som helst — fint for å kjenne det igjen i dashbordet

## Steg 3 — Legg til Postgres

1. I prosjektet: **Create new** → **Addon** → **PostgreSQL**
2. Navn: `hallakompis-db`
3. Versjon: **16**
4. Plan: minste tilgjengelige (nf-compute-20 eller nf-compute-50)
5. Lagring: 5 GB (kan økes senere)
6. Extensions: huk av **vector** og **pg_trgm**
7. Create

Vent ~2 min til den er klar. Gå deretter til addonet → **Connection details** → noter connection string.

## Steg 4 — Legg til Redis

1. **Create new** → **Addon** → **Redis**
2. Navn: `hallakompis-redis`
3. Versjon: 7
4. Plan: minste
5. Persistence: på
6. Create

## Steg 5 — Opprett secret group

1. **Create new** → **Secret group** → `hallakompis-secrets`
2. Legg til:
   - `ANTHROPIC_API_KEY` = din Claude-nøkkel
   - `SESSION_SECRET` = den du genererte med openssl
3. Under **Linked addons**: legg til både `hallakompis-db` og `hallakompis-redis`
   - Dette gjør at `DATABASE_URL` og `REDIS_URL` blir automatisk tilgjengelig i tjenester som bruker secret group
4. Save

## Steg 6 — Deploy API-servicen

1. **Create new** → **Combined service** (build + deploy samme sted)
2. Source:
   - Type: **Git repository**
   - Repo: velg Kompis-repoet
   - Branch: `main`
   - Build context: `/` (repo-roten — viktig fordi vi har monorepo)
3. Build:
   - Dockerfile path: `apps/api/Dockerfile`
   - Build rules / Path rules: kun bygg når disse endres:
     - `apps/api/**`
     - `packages/**`
     - `pnpm-lock.yaml`
4. Service:
   - Name: `hallakompis-api`
   - Plan: nf-compute-20
   - Port: **3001**, public HTTP
5. Environment:
   - Under **Runtime secrets**: link `hallakompis-secrets`
6. Deploy

Første build tar 4–6 min. Når den er klar, se **Domains** for å finne URL-en (noe som `p01--hallakompis-api--abcdef.code.run`). Test: `curl https://din-api-url/health` skal returnere `{"status":"ok"}`.

## Steg 7 — Kjør DB-migrasjoner mot produksjon

På Mac-en din, kjør én gang:

```bash
# Hent connection string fra Postgres-addonet
DATABASE_URL="postgres://..." pnpm db:push
DATABASE_URL="postgres://..." pnpm db:seed
```

Dette oppretter alle tabellene og legger inn familien Goberg.

## Steg 8 — Deploy Web-servicen

1. **Create new** → **Combined service**
2. Source:
   - Repo: Kompis
   - Branch: `main`
   - Build context: `/`
3. Build:
   - Dockerfile path: `apps/web/Dockerfile`
   - Path rules: `apps/web/**`, `packages/shared/**`, `pnpm-lock.yaml`
4. Service:
   - Name: `hallakompis-web`
   - Port: **3000**, public HTTP
5. Environment:
   - Legg til `NEXT_PUBLIC_API_URL` = URL-en til `hallakompis-api` fra steg 6
   - Legg til `WEB_ORIGIN` på API-servicen så CORS fungerer (gå tilbake til hallakompis-api → env → legg til `WEB_ORIGIN=https://din-web-url`)
6. Deploy

## Steg 9 — Test

Åpne web-URL-en → velg Goberg → skriv i chatten: "Legg til kaffe på handlelisten".

## Når noe går galt

**Byggfeil:** Se build logs i servicen → vanligvis manglende env-variabel eller typefeil.

**Runtime-feil:** Se service logs. For API: `curl https://din-api-url/health` først, så sjekk Postgres-tilkobling.

**CORS-feil i nettleseren:** `WEB_ORIGIN` mangler eller feil på API-servicen.

**Kan ikke logge inn:** Sjekk at `pnpm db:seed` gikk. Gå inn på Postgres-addonet → query editor → `SELECT * FROM users;` bør vise Goberg, Ida, Emma, Noah, Olivia.

**Sesjoner utløper med en gang:** `SESSION_SECRET` må være samme verdi på API. Sjekk secret group.

## Continuous deployment

Push til `main` trigger automatisk ny build av begge services (så lenge endrede filer matcher path rules). Ingen CLI nødvendig.

## Preview-miljøer (valgfritt, senere)

Når du begynner å jobbe med branches:
- I hver service: **Build settings** → **Enable PR builds**
- Northflank lager automatisk en midlertidig versjon per pull request
- Husk: preview-miljøer peker på *samme* Postgres (enkelt) eller egen DB (tryggere — dyrere)

## Kostnad estimert

Med smalest plan på alle tjenestene:
- Postgres: ~$5/mnd
- Redis: ~$3/mnd
- hallakompis-api: ~$5/mnd
- hallakompis-web: ~$5/mnd

Totalt: ~$18–20/mnd for full drift. Kan skaleres opp når du trenger det.
