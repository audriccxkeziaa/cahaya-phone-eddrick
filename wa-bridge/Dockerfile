FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p wa-session

EXPOSE 3001

# Memori: 128MB terlalu kecil untuk Baileys (session + key store + message
# store) → rawan OOM → crash → restart loop → sesi enkripsi kacau (Bad MAC) →
# pesan nyangkut centang 1. Railway punya RAM jauh lebih besar, jadi naikkan.
CMD ["node", "--max-old-space-size=512", "index.js"]
