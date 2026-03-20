FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
COPY public/ public/
EXPOSE 4021
CMD ["node", "server.js"]
