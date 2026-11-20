FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./

EXPOSE 8000

ENV PORT=8000
ENV NODE_ENV=production

CMD ["node", "server.js"]
