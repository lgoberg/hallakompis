# Identitet og innlogging på hallakompis

Besluttet 11.08.2026. **Ikke implementert ennå**, dette er planen.

## Utgangspunktet

Fem tjenester med tre ulike modeller, og de tre nyeste har ingen:

| Tjeneste | Innlogging i dag | Hva som ligger der |
|---|---|---|
| portal | ingen | ingenting |
| sykkeltid | felles løpskode, egne økter | løpsdata, offentlig resultatliste |
| tiern | **ingen** | familienavn, kamphistorikk, humør, kveldsnotat |
| fortelling | **ingen** | dagbokaktig input om dagen deres |
| kompis (api + web) | husstand + person, valgfri PIN | oppgaver, handleliste, chat, minne |

`fortelling` er den mest personlige av dem, siden premisset er «skriv inn hva som
skjedde hos oss», og den ligger åpen på internett i dag.

## Beslutninger

1. **Én innlogging for hele hallakompis.** Kompis er identitetskilden.
2. **Profilvalg uten PIN.** Du velger hvem du er, ingen kode i hverdagen.
   Beskyttelsen mot omverdenen ligger på husstands-nivået, ikke mellom personene.
   (`users.pinHash` finnes fortsatt i skjemaet og kan tas i bruk senere.)
3. **Barna ser alt i husstanden, men ikke voksnes private.** Skillet finnes
   allerede: `users.role` er en enum med `adult` som standard.

## Fire tilgangsnivåer, ikke to

1. **Åpent** - resultatlista fra løpet. Skal kunne deles med hvem som helst.
2. **Gjest med oppgave** - postmannskapet på løpsdagen. Verken familie eller
   publikum. Dagens løpskode i `sykkeltid` er riktig verktøy for dem og beholdes.
3. **Husstanden** - tiern, fortelling, handleliste, kalender.
4. **Personen** - chat-minne, egne oppgaver, ideer.

## Delt vs unikt

Kompis-skjemaet har allerede svart på dette, og inndelingen generaliserer:

```
households                    toppnivået, «Familien Goberg»
  users                       personer, med role = adult | child

DELT I HUSSTANDEN             shopping_items, calendar_events
PRIVAT PER PERSON             tasks, ideas, memory_facts, memory_events,
                              voice_sessions, message_channels, sessions
BEGGE                         user_layouts (husstand + eier)
```

Nye tjenester føyer seg inn slik:

| Data | Nivå | Hvorfor |
|---|---|---|
| Kortspill-historikk og statistikk | husstand | handler om at familien spiller sammen |
| Kveldsnotat og humør | husstand | konteksten rundt kvelden er felles |
| Fortellinger | husstand | spunnet ut av «vår dag» |
| Løpsdata | egen, gjest med oppgave | ikke familie-data |

## Mekanismen: signert identitetskapsel, ikke oppslag

Alt ligger nå under `hallakompis.no`, så en informasjonskapsel satt på
`.hallakompis.no` leses av alle subdomenene.

**Ikke** la de enkle tjenestene spørre Kompis-API-et ved hver forespørsel. Det
ville gjort tiern og fortelling avhengige av at Kompis er oppe, og de er med
vilje uten avhengigheter.

I stedet: Kompis utsteder ved profilvalg en **signert identitetskapsel** på
`.hallakompis.no` med `{householdId, userId, navn, rolle, exp}` og en HMAC-SHA256
over innholdet, med en delt hemmelighet (`HALLAKOMPIS_SECRET`). Hver tjeneste
verifiserer den **lokalt** med Node sin egen `crypto`. Ingen nettverkskall, ingen
ny avhengighet, og tiern virker selv om Kompis er nede.

Dette er samme mønster som `sjekkGate` i lyttio, så det er kjent territorium.

Ulempen er at en økt ikke kan trekkes tilbake momentant, bare utløpe. For en
familie er det greit. Sett utløp på ~30 dager og forny ved hvert besøk i Kompis.

## Rekkefølge når det skal bygges

1. `kompis.hallakompis.no` må opprettes først. Kapselen kan bare settes på
   `.hallakompis.no` når Kompis faktisk nås på det domenet, ikke på `code.run`.
   Følg oppskriften i minnet: subdomene i Northflank, CNAME hos webhuset mot
   `<sub>.hallakompis.no.ljth-xwgs.dns.northflank.app`, verifiser, tilknytt.
2. Kompis setter identitetskapselen i tillegg til dagens `hallakompis_session`
   (som er vertsbundet i dag: `apps/api/src/routes/auth.ts` setter ingen `domain`).
3. Én liten delt verifiseringsfunksjon, kopiert inn i hver tjeneste heller enn
   en pakke, så tjenestene forblir uavhengige.
4. `tiern` og `fortelling` gates på husstands-nivå.
5. `portal` viser hvem du er, og lar deg bytte profil.
6. `sykkeltid` beholder løpskoden, men en innlogget voksen slipper inn uten den.

## Åpne punkter

- Bytte av kapsel-domene logger ut alle én gang. Uproblematisk, men verdt å vite.
- Hvem skal kunne se fortellinger som er skrevet inn av en annen? Foreløpig
  antatt at alle i husstanden ser alt.
- Skal barn kunne skrive inn i `fortelling`, eller bare lese og høre?
- Kompis krever Postgres og Redis. De koster penger og går i dag for noe som
  ikke er i bruk. Blir Kompis identitetskilden, må de uansett stå.
