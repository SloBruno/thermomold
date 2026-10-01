# ThermoMold

Monitoramento e controle remoto de um circuito de refrigeração de molde. O projeto combina um **ESP32 com sensores físicos**, um **backend Node.js no Render** e um **dashboard React publicado no GitHub Pages**. Também preserva o simulador didático de circuito de refrigeração já existente.

> **Estado atual:** o código suporta dois termopares MAX6675, nível AJ-SR04M, vazão ZJ-S201, duas bombas via relé HW-383 e telemetria em tempo quase real. A validação física do ZJ-S201 e dos relés com as bombas ainda deve ser feita em bancada antes de uso contínuo.

- Dashboard: <https://slobruno.github.io/thermomold/>
- Sensores físicos: <https://slobruno.github.io/thermomold/#/sensor-real>
- Controle de bombas: <https://slobruno.github.io/thermomold/#/bombas>
- API: <https://thermomold.onrender.com/api/telemetry>

## Índice

- [Objetivo e escopo](#objetivo-e-escopo)
- [Arquitetura](#arquitetura)
- [Funcionalidades](#funcionalidades)
- [Hardware e ligações](#hardware-e-ligações)
- [Firmware ESP32](#firmware-esp32)
- [Backend e API](#backend-e-api)
- [Frontend](#frontend)
- [Implantação](#implantação)
- [Desenvolvimento local](#desenvolvimento-local)
- [Segurança e limites atuais](#segurança-e-limites-atuais)
- [Validação de bancada](#validação-de-bancada)
- [Próximas etapas](#próximas-etapas)

## Objetivo e escopo

O ThermoMold é um sistema para acompanhar um pequeno circuito hidráulico de refrigeração e permitir o acionamento remoto de duas bombas.

### Incluído no escopo atual

- Medição de temperatura em dois pontos com dois módulos MAX6675 e termopares tipo K.
- Medição de distância/nível com AJ-SR04M.
- Medição de vazão instantânea e volume acumulado com ZJ-S201.
- Telemetria do ESP32 para a internet por Wi-Fi e HTTPS.
- Dashboard web com atualização periódica e atualização em tempo real por Socket.IO.
- Comando manual de liga/desliga para duas bombas, por relé duplo HW-383.
- Estado seguro: bombas desligadas ao iniciar o ESP32, ao perder Wi-Fi ou ao perder comunicação válida com o backend.
- Portal de provisionamento Wi-Fi e armazenamento persistente da configuração do dispositivo no ESP32.
- Simulador de refrigeração e biblioteca de moldes, independentes da telemetria física.
- Esquema elétrico editável no KiCad, PDF e instruções de montagem em texto.

### Fora do escopo atual

- Controle de velocidade/intensidade das bombas. O HW-383 é relé mecânico e só permite liga/desliga; PWM exige driver MOSFET apropriado.
- Histórico persistente de medições. O backend mantém somente a última leitura em memória.
- Autenticação de operadores para o controle de bombas. O controle foi configurado como público nesta fase.
- Atualização OTA do firmware.
- Calibração física final do fator de pulsos do ZJ-S201.
- Proteções automáticas por nível baixo, falta de vazão, temperatura ou tempo máximo de bomba ligada.

## Arquitetura

```text
                         ┌───────────────────────────┐
                         │ GitHub Pages               │
                         │ React + Vite               │
                         │ Dashboard / Sensores /     │
                         │ Controle de Bombas         │
                         └─────────────┬─────────────┘
                                       │ HTTPS + Socket.IO
                                       │
                         ┌─────────────▼─────────────┐
                         │ Render                     │
                         │ Express + Socket.IO        │
                         │ - valida telemetria        │
                         │ - mantém última leitura    │
                         │ - mantém comando desejado  │
                         └─────────────┬─────────────┘
                                       │ HTTPS POST /api/telemetry
                                       │ resposta inclui comando das bombas
                                       │
                         ┌─────────────▼─────────────┐
                         │ ESP32                      │
                         │ Wi-Fi + LittleFS           │
                         │ Sensores + relés           │
                         └───┬────┬────┬────┬────┬────┘
                             │    │    │    │    │
                     MAX6675 #1  #2  AJ-SR04M ZJ-S201 HW-383
                             │    │    │    │      │
                       Termopar 1 2  Nível  Vazão  2 bombas
```

### Fluxo de telemetria e comando

1. O ESP32 mede os sensores e o estado real dos dois relés.
2. O ESP32 envia um `POST` HTTPS para `/api/telemetry`.
3. O backend valida a leitura, salva a última amostra em memória e a transmite ao site por Socket.IO.
4. O backend responde com o estado desejado das bombas.
5. O ESP32 aplica o comando nos GPIOs D19 e D33.
6. A telemetria seguinte informa o estado físico aplicado.

O ciclo normal de telemetria é de aproximadamente **500 ms**. A vazão é atualizada internamente em uma janela de um segundo.

### Fluxo de provisionamento do ESP32

Na primeira inicialização, ou após apagar a configuração, o ESP32 cria a rede `ThermoMold-Setup`:

1. Conecte um celular ou computador à rede de configuração.
2. Abra `http://192.168.4.1`.
3. Selecione a rede Wi-Fi 2,4 GHz e informe a senha.
4. Informe o endpoint HTTPS e a chave do dispositivo localmente.
5. Salve.

O WiFiManager grava as credenciais de Wi-Fi na flash. O firmware grava `deviceId`, endpoint, chave e intervalo em LittleFS, no arquivo local `/config.json`. Assim, o ESP32 deve reconectar automaticamente após reinício ou queda de energia; não é necessário digitar a chave de novo enquanto a memória não for apagada.

## Funcionalidades

| Área | Funcionalidade | Estado |
|---|---|---|
| Telemetria | Dois MAX6675 | Implementado e já observado fisicamente |
| Telemetria | AJ-SR04M | Implementado e já observado fisicamente |
| Telemetria | ZJ-S201 | Implementado no código; requer calibração/validação física |
| Controle | Duas bombas por HW-383 | Implementado; requer teste elétrico de polaridade do relé |
| Segurança | Desliga bombas em boot, perda de Wi-Fi ou timeout | Implementado no firmware |
| Web | Tela de sensores reais | Implementado |
| Web | Tela manual de bombas | Implementado, pública e sem senha |
| Web | Simulador e biblioteca de moldes | Implementado |
| Persistência | Configuração Wi-Fi/chave no ESP32 | Implementado |
| Persistência | Histórico de telemetria | Não implementado |
| Alertas | Alarmes, notificações e intertravamentos | Não implementado |
| OTA | Atualização por Wi-Fi | Não implementado |

## Hardware e ligações

### Componentes

- ESP32 DevKit.
- Fonte AC-DC 5 V / 6 A.
- Buck step-down 5 V → 3,3 V.
- Dois módulos MAX6675 com termopar tipo K.
- AJ-SR04M.
- ZJ-S201.
- Módulo de relé duplo HW-383.
- Duas bombas de água de 3–6 V.
- Dois diodos 1N4007, um por bomba.
- Seis resistores de 10 kΩ: três para o divisor do AJ-SR04M e três para o divisor do ZJ-S201.

### Distribuição de energia

```text
Fonte +5 V ─┬─ buck IN+
            ├─ VCC do HW-383
            ├─ VCC do AJ-SR04M
            ├─ positivo do ZJ-S201
            └─ COM dos canais K1 e K2

Fonte GND ──┬─ buck IN− e buck OUT−
            ├─ GND do ESP32
            ├─ GND dos MAX6675
            ├─ GND do AJ-SR04M e ZJ-S201
            ├─ GND do HW-383
            └─ negativos das bombas

Buck +3,3 V ── ESP32 3V3 e VCC dos dois MAX6675
```

Ajuste o buck próximo de **3,3 V** antes de conectar o ESP32. Nunca passe de **3,6 V**. Use o pino `3V3` do ESP32; `VIN`, `VN` e `VP` não são entradas para essa alimentação. Não alimente simultaneamente por USB e pelo buck durante a operação normal.

### Tabela de pinos

| Função | ESP32 | Observação |
|---|---:|---|
| MAX6675 #1 SCK / CS / SO | D32 / D21 / D27 | Termopar 1 |
| MAX6675 #2 SCK / CS / SO | D18 / D23 / D22 | Termopar 2 |
| AJ-SR04M TRIG | D25 | Direto |
| AJ-SR04M ECHO | D26 | Via divisor 10 kΩ / 20 kΩ |
| ZJ-S201 sinal | D34 | Via divisor 10 kΩ / 20 kΩ |
| HW-383 IN1 | D19 | Bomba 1 / K1 |
| HW-383 IN2 | D33 | Bomba 2 / K2 |

Os sinais ECHO do AJ-SR04M e o sinal do ZJ-S201 podem ser de 5 V; não os conecte diretamente a um GPIO de 3,3 V.

```text
ECHO ou SINAL → 10k → ponto do GPIO
                           │
                           └→ 10k → 10k → GND
```

O divisor gera aproximadamente 3,33 V quando a entrada é exatamente 5 V.

### Bombas e relés

- K1: `COM` recebe +5 V; `NO` vai ao positivo da bomba 1; negativo da bomba 1 vai ao GND comum.
- K2: `COM` recebe +5 V; `NO` vai ao positivo da bomba 2; negativo da bomba 2 vai ao GND comum.
- `NC` permanece sem ligação nesta arquitetura.
- Cada bomba recebe um 1N4007 em paralelo: **faixa do diodo no positivo**, sem faixa no negativo/GND.

Consulte [`hardware/README.md`](hardware/README.md) para o procedimento detalhado de montagem. Os artefatos do esquema estão em [`hardware/`](hardware/): KiCad, PDF e PNG.

## Firmware ESP32

Pasta: [`firmware/`](firmware/)

Tecnologias principais:

- PlatformIO e Arduino para ESP32.
- `WiFiManager` para portal e credenciais Wi-Fi persistentes.
- `LittleFS` para a configuração local não-Wi-Fi.
- `HTTPClient` e `WiFiClientSecure` para envio de telemetria HTTPS.
- `ArduinoJson` para configuração e resposta de comandos.
- `MAX6675` para os termopares.
- Interrupção em D34 para contar os pulsos do ZJ-S201.

### Fail-safe das bombas

As saídas de relé são configuradas para desligado antes de abrir o portal Wi-Fi. Durante a execução:

- Se o Wi-Fi cair, ambas as bombas são desligadas.
- Se um comando válido do backend não chegar por 3 segundos, ambas as bombas são desligadas.
- Se a resposta de telemetria não trouxer comando de bombas válido, ambas as bombas permanecem desligadas.

O HW-383 pode ser ativo-alto ou ativo-baixo. O firmware está configurado inicialmente como ativo-alto por `kRelayActiveLevel = HIGH`. Faça o teste sem as bombas e inverta para `LOW` se os LEDs/relés ligarem ao iniciar.

### Vazão

A conversão inicial usa a constante de família YF/ZJ-S201:

```text
frequência de pulsos (Hz) = 7,5 × vazão (L/min)
```

Ela é um ponto de partida. Calibre com um volume conhecido e ajuste `kFlowPulsesPerLiterPerMinute` em [`firmware/include/actuators.h`](firmware/include/actuators.h) se o sensor físico divergir.

### Compilar, testar e gravar

```bash
cd firmware
platformio test -e native
platformio run -e esp32dev
platformio run -e esp32dev -t upload
platformio device monitor -b 115200
```

Leia também [`firmware/README.md`](firmware/README.md).

## Backend e API

Pasta: [`server/`](server/)

O backend usa Express, Socket.IO e TypeScript. Ele valida as leituras, mantém a última amostra, publica mudanças para o dashboard e armazena o comando desejado das bombas em memória.

### Endpoints principais

| Método | Rota | Função |
|---|---|---|
| `GET` | `/health` | Health check do serviço |
| `GET` | `/api/telemetry` | Última telemetria e estado `online`, `stale` ou `offline` |
| `POST` | `/api/telemetry` | Recebe a telemetria autenticada do ESP32 |
| `GET` | `/api/pumps` | Estado desejado das duas bombas |
| `POST` | `/api/pumps` | Altera o estado desejado: `{"pump1":true}` ou `{"pump2":false}` |

### Contrato resumido de telemetria

```json
{
  "deviceId": "thermomold-abc123",
  "temperatureC": 25.5,
  "sensor": "MAX6675",
  "sensors": {
    "thermocouples": [
      { "id": "max6675-1", "temperatureC": 25.5 },
      { "id": "max6675-2", "temperatureC": 24.8 }
    ],
    "level": { "sensor": "AJ-SR04M", "distanceMm": 227 },
    "flow": { "sensor": "ZJ-S201", "litersPerMinute": 1.2, "totalLiters": 3.45 }
  },
  "pumps": { "pump1": false, "pump2": false }
}
```

A resposta HTTP inclui `commands.pumps`. O ESP32 não expõe os sensores nem os relés diretamente para a internet; só ele faz a conexão de saída ao backend.

### Variáveis de ambiente do servidor

| Variável | Obrigatória em produção | Uso |
|---|---|---|
| `PORT` | Não | Porta HTTP; o Render define automaticamente |
| `CLIENT_ORIGIN` | Sim | Origem permitida do GitHub Pages, sem o caminho do repositório |
| `TELEMETRY_DEVICE_KEY` | Sim | Chave aceita em `X-Device-Key` nos envios do ESP32 |
| `TELEMETRY_STALE_MS` | Recomendado | Tempo sem leitura para marcar telemetria como desatualizada; padrão 30000 |

Segredos devem existir apenas no painel do Render ou no portal local do ESP32. Nunca os coloque em commits, issues, chat ou arquivos rastreados.

## Frontend

Pasta: [`client/`](client/)

O dashboard é React + TypeScript + Vite e usa HashRouter, permitindo rotas estáticas no GitHub Pages.

Principais telas:

- **Simulador:** cenário de refrigeração e falhas simuladas.
- **Sensor Real:** temperaturas, distância de nível, vazão e estado confirmado das bombas.
- **Bombas:** comando manual e comparação entre o estado desejado e o último estado confirmado pelo ESP32.

O frontend consulta REST e recebe eventos Socket.IO. Há também atualização periódica para que a tela se recupere quando uma conexão de socket é interrompida.

## Implantação

### Backend: Render

[`render.yaml`](render.yaml) define o serviço Node.js na pasta `server/`:

```text
build: npm ci && npm run build
start: npm run start
```

No Render, configure pelo menos:

```text
CLIENT_ORIGIN=https://slobruno.github.io
TELEMETRY_DEVICE_KEY=[seu segredo local]
TELEMETRY_STALE_MS=30000
```

### Frontend: GitHub Pages

O workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) roda a cada push em `main`.

Defina a variável de repositório GitHub:

```text
VITE_SOCKET_URL=https://thermomold.onrender.com
```

O workflow força `VITE_ROUTER_MODE=hash` e a base `/<nome-do-repositório>/`, então as rotas usam `#/...` corretamente no Pages.

### Ordem correta para uma atualização funcional

1. Testar firmware, servidor e cliente localmente.
2. Fazer commit e push para `main`.
3. Aguardar o deploy do GitHub Pages e do Render.
4. Gravar o firmware novo no ESP32, quando houver mudança de firmware.
5. Conferir `/api/telemetry` e o dashboard com o ESP ligado.

Publicar o código não atualiza o firmware que já está gravado no ESP32.

## Desenvolvimento local

Pré-requisitos:

- Node.js 20 ou superior.
- npm.
- PlatformIO para firmware.
- Python 3 para o ambiente do PlatformIO, quando necessário.

```bash
# Backend
cd server
npm ci
npm test
npm run build
npm run dev

# Em outro terminal: frontend
cd client
npm ci
npm run build
npm run dev

# Firmware
cd firmware
platformio test -e native
platformio run -e esp32dev
```

Endereços locais usuais:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

Use os arquivos `client/.env.example` e `server/.env.example` somente como modelos locais. Não crie arquivos com segredo dentro do repositório.

## Segurança e limites atuais

### Riscos conhecidos

1. **Controle de bombas é público.** A rota e a página não têm autenticação nesta fase. Quem tiver acesso ao site pode enviar comando de liga/desliga.
2. **Sem histórico persistente.** Leituras e estado desejado de bomba ficam em memória; uma reinicialização do Render remove os dados e reinicia as bombas desejadas como desligadas.
3. **TLS sem validação completa no ESP32.** O transporte usa HTTPS, mas o firmware usa `setInsecure()` enquanto não há sincronização de relógio/NTP e CA fixada. O tráfego é criptografado, porém a identidade do servidor não é validada pelo ESP32.
4. **Sem intertravamento por nível ou vazão.** O fail-safe de comunicação existe, mas o sistema ainda não recusa bomba com tanque vazio ou falta de fluxo.
5. **Divisores próximos ao limite.** A saída de aproximadamente 3,33 V é aceitável para fonte nominal de 5 V, mas perde margem se a fonte estiver acima disso. Meça antes de ligar ao ESP32.

### Medidas já implementadas

- Sem chaves em código ou no repositório.
- Cabeçalho `X-Device-Key` para autenticar telemetria no backend.
- Bombas desligadas por padrão em boot e por falha de comunicação.
- Validação de formato e faixa de cada leitura no backend.
- GPIOs de relé inicializados como desligados antes de qualquer operação de rede.

## Validação de bancada

Antes de conectar as bombas:

1. Ajuste e meça o buck em 3,3 V.
2. Confira todos os GNDs comuns.
3. Conecte o sistema sem as bombas nos bornes `NO`.
4. Energize o ESP32 pela fonte/buck e observe os LEDs do HW-383.
5. Os relés devem iniciar desligados. Se ligarem, ajuste `kRelayActiveLevel` e grave o firmware novamente.
6. Acione uma bomba por vez na página **Bombas** e confirme LED e clique do relé.
7. Meça a tensão no D26 e D34 com os sensores em nível alto; não pode ultrapassar 3,6 V.
8. Só então conecte as bombas e teste com água.
9. Meça um volume conhecido para calibrar o ZJ-S201.

Não use este sistema sem supervisão até concluir esses testes e adicionar os intertravamentos de nível e vazão.

## Próximas etapas

Ordem recomendada:

1. Validar eletricamente relés, bombas e ZJ-S201.
2. Implementar intertravamento: bloquear/desligar bomba por nível baixo e por vazão zero.
3. Adicionar limites de temperatura e alarmes visuais no site.
4. Criar persistência de séries históricas em banco de dados, com retenção e exportação CSV.
5. Proteger a página e API de bombas por autenticação e lista de operadores permitidos.
6. Implementar OTA com validação de integridade e rollback.
7. Criar bot de WhatsApp isolado para dúvidas técnicas, estado do equipamento e alertas — sem acesso direto ao computador ou a comandos irrestritos.

## Estrutura do repositório

```text
.
├── client/       # Dashboard React/Vite
├── server/       # API Express, Socket.IO e simulador
├── firmware/     # ESP32 / PlatformIO
├── hardware/     # KiCad, PDF, PNG e instruções de montagem
├── shared/       # Tipos compartilhados TypeScript
├── render.yaml   # Blueprint do Render
└── .github/      # Deploy do GitHub Pages
```

## Licença e operação

Este repositório é um projeto de engenharia em desenvolvimento. As ligações e comandos de bombas envolvem eletricidade, água e equipamento físico. Revise a montagem, use proteção adequada para a instalação final e mantenha supervisão humana durante os testes.
