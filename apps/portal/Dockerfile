# Portalen er en statisk side servert av Node, uten avhengigheter og uten
# byggsteg. NB: byggkonteksten er REPOROTA, ikke denne mappa (Northflank
# bruker "/" som standard).
FROM node:20-alpine

WORKDIR /app
COPY apps/portal/ ./

ENV PORT=4700
EXPOSE 4700

CMD ["node", "server.js"]
