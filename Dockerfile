FROM node:20-alpine

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências de produção
RUN npm install --omit=dev

# Copiar todo o código-fonte da aplicação
COPY . .

# Garantir existência da pasta de uploads
RUN mkdir -p /app/public/uploads

# Expor a porta da aplicação
EXPOSE 3000

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000

# Comando para iniciar o servidor
CMD ["node", "server.js"]

