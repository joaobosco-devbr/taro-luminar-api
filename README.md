# API Tarô Luminar

API backend do projeto **Tarô Luminar**, responsável por:
- Autenticação via API Key
- Leitura de tarô
- Integração futura com meios de pagamento (Mercado Pago)
- Controle de acesso às leituras

## Tecnologias
- Node.js
- Express
- Mercado Pago SDK
- Dotenv

## Segurança
Este projeto **não expõe chaves sensíveis**.
Tokens, Access Keys e credenciais são gerenciados via variáveis de ambiente (`.env`).

## Execução local

```bash
npm install
node index.js

