# Tidtakingsappen kjoerer helt for seg selv: ingen avhengigheter, ingen
# database, ingen byggsteg. Derfor kopierer vi bare mappa inn i et rent
# node-image. Loepsdataene skal ligge paa et persistent volum montert paa
# /data, slik at de overlever en omstart.
FROM node:20-alpine

WORKDIR /app
COPY . .

ENV PORT=4600
ENV SYKKELTID_DATA=/data
VOLUME ["/data"]
EXPOSE 4600

CMD ["node", "server.js"]
