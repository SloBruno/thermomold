# Calibração de vazão por volume conhecido

Painel na página **Sensor Real**, referência padrão **500 mL**, editável antes de iniciar. Iniciar solicita ambas ON; Parar solicita ambas OFF imediatamente no estado desejado do backend e espera uma nova telemetria com `pumps` OFF para finalizar. Nenhuma requisição é enviada diretamente ao ESP. O próximo POST do ESP recebe `commands.pumps`.

## Resultado e limites

- Tempo exibido = intervalo entre comandos no servidor, **não** tempo de contatos físicos ligados.
- O painel coleta número de amostras, último L/min, volume de referência, volume medido, diferença, pulsos (quando disponíveis), janela de telemetria e proposta de correção.
- Firmware atual: `sensors.flow.totalLiters` deriva de pulsos **aceitos pelo filtro**, nominalmente `/450`; o filtro mínimo e a confirmação por janelas podem descartar pulsos. Sua diferença é exibida apenas como **volume filtrado informativo**, sem fator proposto e sem reconstruir pulsos a partir de L/min.
- Com contrato bruto válido, `pulses = final.rawTotalPulses - inicial.rawTotalPulses`; `measuredMl = pulses / pulsesPerLiter * 1000`; `proposedFactor = referenceMl / measuredMl`; `proposedPulsesPerLiter = pulses / (referenceMl / 1000)`. O multiplicador vale para volume/vazão; o novo coeficiente em pulsos/L é o divisor correspondente, não o multiplicador.
- Baseline = última amostra recente antes do comando ON. Final = primeira nova amostra posterior ao comando OFF com ambas as bombas reportadas OFF. Janela e atraso ficam visíveis; podem incluir pulsos anteriores ao ON e fluxo residual posterior ao OFF. Para metrologia exata, o firmware precisa capturar contadores junto da aplicação dos comandos e devolver identificador da coleta, limites e timestamps.
- ON/OFF reportados são estados lógicos; não representam confirmação de contatos nem intertravamento físico. O operador deve confirmar recipiente/circuito seguro e volume real antes de usar a proposta.
- Não há endpoint de aplicação do fator. Nenhum fator é enviado ao firmware nem salvo automaticamente; integração persistente e confirmação explícita do operador ainda são pendentes.

## Campos remotos exigidos para liberar proposta

Dentro de `sensors.flow`, junto de `sensor: "ZJ-S201"`, `litersPerMinute` e `totalLiters`, o firmware deve publicar os **três campos juntos**:

```json
{
  "rawTotalPulses": 12345,
  "counterEpoch": "boot-unique-id",
  "pulsesPerLiter": 450
}
```

- `rawTotalPulses`: inteiro seguro JS, cumulativo de bordas cruas da ISR, sem filtro de vazão; leitura atômica. Nunca usar o contador aceito nem sintetizar via L/min.
- `counterEpoch`: string não vazia `[A-Za-z0-9._:-]`, até 96 caracteres; nova a cada boot, reset ou wrap do contador. Mesmo valor durante uma coleta.
- `pulsesPerLiter`: número finito positivo, coeficiente nominal/ativo usado para converter **esse contador bruto** em volume. Deve ser consistente durante a coleta.
- Campos existentes `deviceId`, `observedAt` (timestamp correto, estritamente crescente), e `pumps: { pump1, pump2 }` continuam necessários.

O backend preserva esses campos em GET/Socket.IO da telemetria, mas este commit **não modifica o firmware**. `RAW_FLOW` somente por USB não habilita a proposta remota.

Para aplicar futuramente: adicionar comando de calibração de vazão com revisão, confirmação explícita e limites; persistência NVS no ESP; publicar revisão/cofeficiente aplicado como confirmação. Nunca declarar aplicação só pelo envio do comando.

## API e segurança

- `GET /api/flow-calibration`: estado (idle/collecting/stopping/complete/failed), resultado ou motivo de falha.
- `POST /api/flow-calibration/start { "referenceMl": 500 }`: exige ambas bombas comandadas/reportadas OFF e amostra de fluxo recebida/observada há no máximo 12 s; retorna `id` da sessão.
- `POST /api/flow-calibration/heartbeat { "id": "..." }`: renovação a cada 1 s pela aba iniciadora. Lease de 5 s; heartbeat nunca religa bombas.
- `POST /api/flow-calibration/stop {}`: solicita ambas OFF, mesmo sem sessão ativa; aguarda amostra final.
- `POST /api/flow-calibration/abort {}`: ambas OFF e coleta inválida.

Watchdog de 500 ms remove comandos ON se lease expirar, telemetria parar por 12 s ou coleta ultrapassar 120 s. Não há timers que liguem bombas. Reiniciar backend começa OFF. Fechar/sair da página tenta abort keepalive; perda de rede ou requisição falha tenta abort e fallback OFF. Sem rede, entrega não é garantida: o lease no servidor remove ON, e o watchdog existente no firmware é outra camada (não um intertravamento físico). Estado de coleta é em memória, não persistente. Um único ensaio por backend; comandos manuais ON durante coleta são rejeitados; OFF manual invalida a coleta e desliga ambas.

Reset/decréscimo de contador, mudança de dispositivo/epoch/coeficiente, desaparecimento do contrato bruto, amostras fora de ordem, zero de tempo ou volume invalidam a coleta e não geram fator. Não existe confirmação física de desligamento.

Endpoints seguem a política de acesso existente dos controles de bombas (sem autenticação de operador adicionada aqui). Não publicar controles de atuadores em rede não confiável sem proteção externa/autorização adequada.

## Verificação sem hardware

```sh
npm ci --prefix server
npm test --prefix server
npm run build --prefix server
npm ci --prefix client
npm test --prefix client
npm run build --prefix client
```

Testes usam stores locais, relógio controlado, HTTP loopback com bombas simuladas e fetch simulado na UI. Nenhum endpoint de produção ou hardware é chamado. Existem avisos de dependências herdadas no projeto e no stack de testes Vitest compatível com Vite 5; a migração de toolchain fica fora deste escopo (não executar servidor de testes em rede pública).
