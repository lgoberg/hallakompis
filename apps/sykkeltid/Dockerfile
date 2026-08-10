# Tidtakingsappen kjoerer helt for seg selv: ingen avhengigheter, ingen
# database, ingen byggsteg. Derfor kopierer vi bare mappa inn i et rent
# node-image.
#
# NB: byggkonteksten er REPOROTA, ikke denne mappa. Det er Northflank sin
# standard ("/"), og en Dockerfile som stille antar noe annet er den klassiske
# maaten aa faa "cannot find module server.js" paa. Lokalt tilsvarer det:
#   docker build -f apps/sykkeltid/Dockerfile .
FROM node:20-alpine

WORKDIR /app
COPY apps/sykkeltid/ ./

# Loepsdataene skal ligge paa et persistent volum montert her, slik at de
# overlever omstart og ny utrulling.
ENV PORT=4600
ENV SYKKELTID_DATA=/data
EXPOSE 4600

CMD ["node", "server.js"]
