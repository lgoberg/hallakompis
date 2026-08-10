# NB: byggkonteksten er REPOROTA, ikke denne mappa (Northflank bruker "/").
FROM node:20-alpine

WORKDIR /app
COPY apps/tiern/ ./

ENV PORT=4710
ENV TIERN_DATA=/data
EXPOSE 4710

CMD ["node", "server.js"]
