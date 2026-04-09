# Taro Luminar API

API REST para venda de leituras de taro online.

## Requisitos

- Node.js
- npm

## Como executar

```bash
npm install
node index.js
```

## Ambiente local com Docker

```bash
docker compose up --build
```

O container expoe a API na porta `3000` e persiste o SQLite em um volume Docker nomeado.

## Variaveis de ambiente

Use o arquivo `.env.example` como base.

- `API_KEY`: chave para rotas protegidas
- `MP_ACCESS_TOKEN_TEST`: token de teste do Mercado Pago
- `PAYMENT_WEBHOOK_MAX_RETRIES`: quantidade maxima de tentativas ao consultar o Mercado Pago no webhook
- `PAYMENT_WEBHOOK_RETRY_DELAY_MS`: intervalo entre retries do webhook em milissegundos
- `NODE_ENV`: ambiente da aplicacao
- `APP_NAME`: nome do servico enviado nos logs estruturados
- `ALLOWED_ORIGINS`: lista separada por virgula para restringir CORS
- `PORT`: porta da aplicacao
- `JSON_BODY_LIMIT`: limite maximo do corpo JSON
- `RATE_LIMIT_WINDOW_MS`: janela do rate limit geral
- `RATE_LIMIT_MAX`: limite de requisicoes na janela geral
- `WEBHOOK_RATE_LIMIT_WINDOW_MS`: janela do rate limit do webhook
- `WEBHOOK_RATE_LIMIT_MAX`: limite de requisicoes do webhook na janela
- `DATABASE_FILE`: caminho opcional para o arquivo SQLite

## Rotas principais

- `GET /health`: publica
- `GET /metrics`: protegida por `x-api-key`
- `POST /payment/webhook`: publica
- `POST /users/register`: protegida por `x-api-key`
- `GET /users/:email`: protegida por `x-api-key`
- `POST /payment/create`: protegida por `x-api-key`
- `POST /tarot/sim-ou-nao`: protegida por `x-api-key`

## Comportamento das rotas

- `POST /users/register`: cria um usuario com `credits = 0`; retorna `409` se o e-mail ja existir
- `GET /users/:email`: retorna `name`, `email` e `credits`
- `POST /payment/create`: cria um pagamento PIX de `9.9`
- `POST /payment/webhook`: processa notificacoes do Mercado Pago com retry, registra erros operacionais e credita 1 leitura quando o pagamento aprovado for valido
- `POST /tarot/sim-ou-nao`: consome 1 credito antes de gerar a leitura

## Seguranca

- Validacao de entrada com `zod` para body e parametros
- `rate limit` global e dedicado para webhook
- Rejeicao de `Content-Type` incorreto e JSON malformado
- Limite de tamanho para payload JSON
- Headers defensivos contra ataques comuns
- Bloqueio de payloads suspeitos com chaves perigosas
- `request_id` em todas as requisicoes e logs estruturados
- Logs JSON com `service`, `environment` e `pid`, prontos para ingestao em ELK
- Metricas basicas em memoria expostas no endpoint `GET /metrics`

## Testes

```bash
node test/app.test.js
```

## Deploy

### Render

- Use o arquivo [`render.yaml`](/C:/Users/joao_/source/repos/taro-luminar-api/render.yaml)
- Configure `API_KEY` e `MP_ACCESS_TOKEN_TEST` como secrets no painel
- O disco persistente e montado em `/app/data`

### Railway

- O projeto pode subir diretamente pelo [`Dockerfile`](/C:/Users/joao_/source/repos/taro-luminar-api/Dockerfile)
- Use o arquivo [`railway.json`](/C:/Users/joao_/source/repos/taro-luminar-api/railway.json) para healthcheck e politica de restart
- Configure `API_KEY`, `MP_ACCESS_TOKEN_TEST` e um volume persistente montado em `/app/data`
