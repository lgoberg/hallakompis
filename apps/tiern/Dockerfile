# NB: byggkonteksten er REPOROTA, ikke denne mappa (Northflank bruker "/").
FROM node:20-alpine

WORKDIR /app
COPY apps/tiern/package.json ./
# Eneste avhengighet er Anthropic-SDK-en, til karakterboka. Alt annet i appen
# kjører på Node sine egne moduler. Mangler pakken, faller karakterboka tilbake
# til de faste kommentarene og resten av spillet er upåvirket.
RUN npm install --omit=dev --no-audit --no-fund
COPY apps/tiern/ ./

ENV PORT=4710
ENV TIERN_DATA=/data
EXPOSE 4710

CMD ["node", "server.js"]
