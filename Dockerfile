FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

# RUN npm prune --production

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
