# NB: byggkonteksten er REPOROTA, ikke denne mappa (Northflank bruker "/").
FROM node:20-alpine

WORKDIR /app
COPY apps/fortelling/package.json ./
# Eneste avhengighet er Anthropic-SDK-en, til selve fortellingen. Opplesningen
# går rett mot ElevenLabs over fetch, og resten kjører på Node sine egne moduler.
RUN npm install --omit=dev --no-audit --no-fund
COPY apps/fortelling/ ./

ENV PORT=4720
ENV FORTELLING_DATA=/data
EXPOSE 4720

CMD ["node", "server.js"]
