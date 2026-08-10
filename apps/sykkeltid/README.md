# Godlia Rundt - tidtaking på idealtid

Tidtaking for løp der deltakerne sykler to runder og skal treffe samme
rundetid begge gangene. Vinneren er den med minst forskjell mellom rundene.

Laget for barn og ungdom, og formet etter det: **det finnes ingen startklokke
og ingen timeplan**. Klokka begynner når du trykker. Kommer en tolvåring to
minutter for sent til startområdet, spiller det ingen rolle. Rekkefølgen er
også fri, send ut den som er klar.

## Kom i gang

```bash
node sykkeltid/server.js
```

Serveren starter på `http://localhost:4600` og skriver ut innloggingskoden.
Standardkoden er `sykkel`. Sett din egen med `SYKKELTID_KODE`:

```bash
SYKKELTID_KODE=godlia2026 node sykkeltid/server.js
```

Ingen `npm install` er nødvendig. Systemet bruker bare Node sine egne moduler
og trenger Node 18 eller nyere.

## De tre flatene

**Startposten** (telefon) får en rullbar liste over alle som ikke er sendt ut,
med nummer, navn og alder. Trykk på raden når rytteren slippes. Øverst står en
teller for hvor lenge siden forrige start gikk, som blir grønn når det er gått
så lenge som det anbefalte mellomrommet. Den telleren er viktigere enn den ser
ut: mellomrommet ved start er det som avgjør hvor hardt målposten blir
belastet.

**Målposten** (helst nettbrett) får et rutenett med alle startnumrene. Fargen
viser hvor rytteren er:

| Farge | Betydning |
|---|---|
| Hvit | ikke startet |
| Oransje, merket R1 | ute på runde 1 |
| Lilla, merket R2 | ute på siste runde |
| Grønn, merket ✓ | i mål |

Ett trykk flytter rytteren ett hakk. Rutene ligger fast og sorterer seg aldri
om, slik at fingeren lærer hvor tallene er.

**Storskjermen** ligger på `/tv` og krever ingen innlogging. Den veksler
mellom rutenettet og resultatlistene. Kjør den helst fra en laptop på HDMI.
Nettleseren i en TV er ofte gammel og upålitelig, og skjermsparere slår inn.

## Hvordan et løp gjennomføres

### Før løpsdagen

1. Legg inn startlista under **Deltakere**. Du kan lime inn rett fra regneark:
   `startnr;navn;alder;klasse`, én rytter per linje. Alder og klasse kan stå i
   hvilken som helst rekkefølge, og kan sløyfes.
2. Sett navn, dato, antall runder og antatt rundetid under **Oppsett**.
3. Sett aldersgruppene, for eksempel `6-9, 10-12, 13-15, 16+`. Resultatlista
   kan vises sammenlagt eller delt i disse gruppene. Grupperingen påvirker
   ikke tidtakinga, bare hvordan resultatene sorteres, så den kan endres når
   som helst, også etter at løpet er ferdig.
4. Øv. Under **Data** kan du lage 20 testryttere og simulere et helt løp.
   Nullstill etterpå.

### Løypa må stemme

Hele konkurransen hviler på at de to målte strekningene er like lange.
Strekningen fra startområdet fram til tidtakerstreken må altså tilsvare én
full runde. Er den for eksempel en kvart runde kortere, får en unge som sykler
helt jevnt likevel over et minutt i avvik, og vinneren blir den som tilfeldigvis
økte farten mest på siste runde. Da måler løpet det motsatte av det det skal
måle.

Noen meter fra eller til betyr derimot ingenting. Ti meter er omtrent ett
sekund, likt for alle, mot forventede avvik på titalls sekunder.

Passer ikke geometrien, bytt til **Ved tidtakerstreken** under Oppsett. Da
begynner klokka først når rytteren krysser streken, begge rundene måles på
nøyaktig samme strekning, og målposten registrerer tre passeringer per rytter i
stedet for to. Startposten registrerer da ingenting.

### På løpsdagen

Målposten trykker på rytterens rute i det hjulet krysser streken. Et stort
kvitteringsfelt nederst viser hvem som ble registrert og hvilken rundetid det
ga, med en angreknapp rett ved siden av. Ser du feil navn, angrer du med en
gang.

Rekker du ikke å lese nummeret, trykk **Rakk ikke å lese nummeret, ta tiden
nå**. Tiden blir tatt vare på, og du knytter den til rytteren når du vet hvem
det var. Det er bedre enn å gjette.

Hold inne en rute for å åpne rytteren: der ser du alle tidene, kan justere dem
et sekund av gangen, slette en passering, eller sette DNF og DNS.

### Etter løpet

Resultatlista er ferdig i det siste rytteren er registrert. Velg
**Sammenlagt**, **Aldersgrupper** eller **Klasser**, skriv ut, og last ned CSV.
Last også ned hele løpet som fil under **Data**.

## Bemanning og belastning

Med 100 deltakere, 30 sekunders mellomrom og 5 minutters runde tar utsendingen
50 minutter. Midt i løpet passerer det i hvert 30-sekundersvindu én som
sendes ut, én som fullfører runde 1 og én som går i mål. Det blir **ett trykk
hvert tiende sekund** i snitt, rundt 300 trykk totalt.

Det krever to personer: en som roper nummer og en som trykker. Går dere ned
til 20 sekunders mellomrom for å bli fortere ferdig, blir det et trykk hvert
sjuende sekund, og det er for hardt. Er aldersspennet stort, med noen på fem
minutter og noen på åtte, blir det mye innhenting og klynging ved streken. Da
er puljer per aldersgruppe det enkleste grepet.

**Bare én enhet skal registrere passeringer.** En reserveenhet kan gjerne logge
inn og ligge klar, den ser samme løp og kan overta umiddelbart hvis den første
dør, men trykker to enheter, blir hver rytter registrert to ganger.

## Hva som er tenkt på

**Nøyaktighet.** Er du konsekvent to sekunder treg på knappen, forsvinner det
helt ut av regnestykket, fordi runde 1 og runde 2 måles mellom de samme
trykkene. Det som koster er variasjonen. Og merk at **midterste trykk teller
dobbelt**: registreres rundepasseringen tre sekunder for sent, blir runde 1 tre
sekunder for lang og runde 2 tre sekunder for kort, altså seks sekunder feil på
differansen. Beskjeden til den ved streken bør derfor være «hold jevn rytme»,
ikke «vær nøyaktig».

**Feiltrykk.** Ingen kan passere to ganger på ett minutt når runden er flere
minutter, så et nytt trykk på samme rute innen 60 sekunder blir stoppet og må
bekreftes. Blir en rundetid urimelig kort eller lang, sier kvitteringen fra med
rødt. Angre virker på tvers av postene, og alt havner i loggen med navnet på
den som gjorde det.

**Klokkene.** To telefoner går sjelden helt likt, og et avvik mellom
startposten og målposten ville gitt systematisk feil på runde 1 for samtlige.
Hver enhet måler derfor sitt eget avvik mot serveren og korrigerer for det.
Avviket vises under Data. Er klokka ikke stilt, sier appen fra med rød tekst.

**Dekning.** Registreringene tidsstemples på enheten i det du trykker, ikke på
serveren, så treg forbindelse påvirker ikke tidene. Mister posten dekningen,
fortsetter alt som normalt: registreringene legges i kø, lagres i enheten og
sendes automatisk når linja er tilbake. Køen overlever at nettleseren startes
på nytt. Toppfeltet viser alltid om noe ligger usendt.

**Storskjermen lekker ikke.** Ryttere som fortsatt er ute vises aldri med
tider. Hele formatet hviler på at du ikke kjenner din egen rundetid underveis,
og det holder ikke å la være å rope det ut hvis tallet står på veggen.

**Strømbrudd.** Serveren lagrer ved hver endring, skriver atomisk slik at fila
aldri blir halvveis skrevet, og tar en full kopi hvert femte minutt under
`data/kopier/`.

## Drift

Dataene ligger i `sykkeltid/data/lop.json`. Sett `SYKKELTID_DATA` for å legge
dem et annet sted, for eksempel på et persistent volum.

Postene og storskjermen må nå serveren. To muligheter:

**Lokalt nett, uten internett.** Fordi startområdet og streken ligger ved siden
av hverandre, dekker ett trådløst nett begge postene. Kjør serveren på en
laptop, la en telefon dele internett (eller bruk laptopens eget nett), koble
alt til samme nett, og gå til `http://<laptopens-ip>:4600`. Ingen kostnad,
ingen avhengighet av mobildekning på stedet. Skulle laptopen dø, ligger siste
kjente tilstand fortsatt i hver telefon.

**På nett.** Serveren er en helt vanlig Node-prosess uten avhengigheter, og kan
kjøres hvor som helst, også i Docker. Da kan startlista fylles ut hjemmefra og
resultatene ses av andre.

Skal du kjøre to løp samtidig, start to instanser med hver sin
`SYKKELTID_DATA` og port.

## Filene

| Fil | Innhold |
|---|---|
| `server.js` | HTTP, innlogging, live-strøm, lagring |
| `felles.js` | Modell, regelmotor og utregninger, delt mellom server og klient |
| `index.html` | Klienten for startposten og målposten |
| `tv.html` | Storskjermvisningen |
| `sw.js` | Cacher appskallet så den laster uten dekning |

`felles.js` kjører begge steder med vilje. Klienten bruker samme regler som
serveren når den regner ut hva et trykk betyr, og det er grunnen til at en post
kan jobbe videre uten nett og likevel vise nøyaktig det serveren vil komme fram
til.
