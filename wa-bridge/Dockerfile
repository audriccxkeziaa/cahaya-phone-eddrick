FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p wa-session

EXPOSE 3001

CMD ["node", "--max-old-space-size=128", "--optimize-for-size", "index.js"]
