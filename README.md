# ThermoMold MVP

Simulador e monitoramento de refrigeração de moldes industriais.

## Desenvolvimento local

Requer Node.js 20 ou superior.

```bash
cd server && npm install && npm run dev
cd client && npm install && npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

As variáveis locais estão documentadas em `client/.env.example` e `server/.env.example`.

## Deploy

O frontend pode ser publicado no GitHub Pages, mas o servidor Socket.IO precisa rodar em uma plataforma Node.js. Esta configuração usa Render para o backend.

### 1. Publicar o backend no Render

1. Crie um serviço Web no Render a partir deste repositório.
2. O blueprint `render.yaml` detecta `server/` automaticamente.
3. Defina `CLIENT_ORIGIN` com a URL do GitHub Pages, por exemplo: `https://SEU_USUARIO.github.io`.
4. Após o deploy, copie a URL pública do Render, por exemplo: `https://thermomold-server.onrender.com`.

### 2. Publicar o frontend no GitHub Pages

1. Em `Settings > Secrets and variables > Actions`, crie a variável de repositório `VITE_SOCKET_URL`.
2. Use como valor a URL pública do Render, sem barra final.
3. Em `Settings > Pages`, selecione `GitHub Actions` como fonte.
4. Faça push para `main` ou execute o workflow `Deploy GitHub Pages` manualmente.

O build de produção usa HashRouter, portanto as rotas funcionam no GitHub Pages sem configuração adicional de redirecionamento.
