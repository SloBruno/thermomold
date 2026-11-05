# Enchimento automático (firmware 0.1.15)

## Operação e limites

O painel **Enchimento do tanque real**, no Dashboard e em Bombas, começa em **Manual**, com ambas OFF. O seletor não controla o simulador. **Automático** exige clique explícito e firmware compatível com telemetria recente. O painel distingue modo solicitado no backend do modo informado pelo ESP32; confirmação continua sujeita ao intervalo da telemetria.

A decisão ocorre **localmente no ESP32**, usando AJ-SR04M e os mesmos extremos do cliente: **333 mm vazio / 293 mm cheio**, com percentual limitado a 0–100%.

| Nível | Bomba 1 | Bomba 2 |
| --- | --- | --- |
| ≤75% (distância ≥303 mm) | ON | ON |
| >75% e <95% (295 mm < distância <303 mm) | ON | OFF |
| ≥95% (distância ≤295 mm) | OFF | OFF |

Cada nova faixa, inclusive a primeira após habilitação ou recuperação, precisa permanecer **≥2000 ms** antes da alteração. Só medianas de **novos bursts concluídos** contam; ticks do loop/telemetria não contam. Ruído ou burst inválido reinicia a confirmação pendente. Lacuna >600 ms entre bursts válidos também reinicia a confirmação. A saída anterior é mantida durante transições breves; **sem leitura válida por >2000 ms, ambas OFF**, com nova confirmação de 2 s para recuperação.

Uma tarefa FreeRTOS independente executa sensor/controle, inclusive durante TLS/HTTP bloqueante. Bursts começam a cada ~400 ms (5 pings, intervalo mínimo 70 ms, timeout individual 50 ms, pelo menos 3 válidos). Bursts inteiramente sem eco podem demorar ~550 ms; continuam inválidos. No boot não há saída automática até habilitação explícita e 2 s de medições válidas.

**Manual / Parar tudo** desliga ambas, cancela automático e coleta de vazão. Qualquer OFF manual também cancela automático; ON manual durante automático é recusado. A coleta não pode começar durante automático; automático não pode começar durante coleta. A perda de Wi-Fi ou watchdog de comandos **>8000 ms** desarma e desliga, mesmo que a faixa atual já peça OFF. O watchdog mantém o limite existente; não foi reduzido para 2 s. Parada remota ainda depende de entrega da resposta HTTP; não substitui corte físico de emergência.

## Protocolo e reinício

- `GET /api/filling`: estado desejado, `mode`, sessão aleatória do backend, `revision`, `deviceSession`.
- `POST /api/filling`: `{ "mode": "automatic", "session": "<GET atual>", "revision": <GET atual> }`; compare-and-set impede habilitação de aba antiga/requisição atrasada.
- `POST /api/filling`: `{ "mode": "manual" }`; parada incondicional, sem exigir revisão.
- `/api/pumps` mantém contrato manual antigo; comandos do backend continuam no caminho exato `commands.pumps`, nunca `sample.pumps`.
- Firmware inclui `control: {deviceSession, mode, session, revision}` na telemetria. `deviceSession` é aleatório por boot, compartilhado com o epoch do contador de fluxo; não é persistido.
- Respostas para firmware compatível incluem os campos de controle em `commands.pumps`. Firmware/payload legado não habilita automático e continua no modo manual.
- Reinício do backend cria nova sessão e Manual/OFF. Uma nova sessão recebida em automático é recusada até novo comando intencional. Reinício do ESP muda `deviceSession` e faz o backend descartar o pedido anterior. Revisões repetidas renovam o watchdog somente enquanto ainda armadas; não rearmam após falha/parada. Resposta malformada desarma.

Não há persistência de modo automático. Calibração dos termopares, arquivos de provisionamento, coeficiente de fluxo **51270.6667 pulsos/L** e extremos do percentual **não foram alterados**. A revisão3 aplicada externamente para referência 20°C não é sobrescrita por este trabalho; oscilações/precisão dos termopares seguem questão separada.

## Verificação offline e futura liberação

```sh
cd firmware
pio test -e native
python test/test_local_control.py
python test/test_loop_schedule.py
python test/test_thermocouple_guardrails.py
pio run -e esp32dev
cd ../server && npm test && npm run build
cd ../client && npm test && npm run build
cd .. && git diff --check
```

Artefatos locais: `firmware/.pio/build/esp32dev/firmware.bin` (0.1.15), `server/dist/` e `client/dist/`. Nenhum foi publicado. O binário público e manifesto OTA existentes **não** foram substituídos. Uma liberação futura exige aprovação separada e coordenação backend + cliente + firmware; para OTA, preparar binário e manifesto versionado com SHA256, preservando LittleFS/calibração/provisionamento. Não executar uploadfs nem redefinir calibração. Fazer com ambas OFF e automático desabilitado; só habilitar após confirmar firmware/sessão e validar sensor/relés em bancada supervisionada. Compilação e testes inertes não comprovam comportamento físico, latência real do sensor ou polaridade dos relés.
