# Taro Luminar API

Backend da plataforma **Taro Luminar**, responsável por orquestrar:

- gerenciamento de usuários
- controle de créditos
- geração de leituras de tarô
- integração com pagamentos via PIX (Mercado Pago)
- processamento assíncrono via webhook

---

## 📌 Overview

A **Taro Luminar API** é uma API RESTful construída com foco em:

- **segurança**
- **controle de acesso**
- **resiliência em pagamentos**
- **observabilidade básica**

O sistema implementa um fluxo completo de monetização:

1. Usuário se registra
2. Usuário gera pagamento (PIX)
3. Webhook confirma pagamento
4. Crédito é liberado
5. Usuário consome crédito para leitura de tarô

---

## 🧱 Arquitetura

A aplicação segue uma estrutura modular inspirada em camadas:


### Componentes principais

- **Routes** → definição de endpoints HTTP
- **Services** → regras de negócio
- **Middlewares** → segurança, validação e controle de requisição
- **Validation (Zod)** → validação de entrada
- **Utils** → logging e métricas
- **Storage** → persistência (SQLite opcional)

---

## ⚙️ Stack Técnica

| Camada        | Tecnologia |
|--------------|-----------|
| Runtime       | Node.js ≥ 22 |
| Framework     | Express 5 |
| Validação     | Zod |
| Segurança     | CORS + Rate Limit + Headers |
| Pagamentos    | Mercado Pago SDK |
| Configuração  | dotenv |
| Observabilidade | Logger + métricas internas |

---

## 🚀 Getting Started

### Pré-requisitos

- Node.js **>= 22**
- npm

### Instalação

```bash
git clone https://github.com/joaobosco-devbr/taro-luminar-api.git
cd taro-luminar-api
npm install
