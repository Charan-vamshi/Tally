FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=Asia/Kolkata

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8000

ENV PORT=8000
ENV NODE_ENV=production

CMD ["node", "server.js"]
