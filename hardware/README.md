# ThermoMold — Esquema elétrico

Arquivos nesta pasta:

- `thermomold.kicad_sch` / `thermomold.kicad_pro` — esquema editável no KiCad 7
- `thermomold.pdf` — versão para imprimir
- `thermomold.png` — prévia

> O esquema KiCad ainda não inclui o sensor de fluxo ZJ-S201. A ligação dele está descrita abaixo e é a referência válida.

## Componentes

- ESP32 DevKit
- Fonte AC-DC 5 V / 6 A
- Buck step-down ajustado para 3,3 V
- 2 módulos MAX6675 com termopar tipo K
- Sensor ultrassônico AJ-SR04M
- Sensor de fluxo ZJ-S201
- Módulo relé duplo HW-383
- 2 bombas de água 3–6 V
- 2 diodos 1N4007
- 6 resistores de 10 kΩ (3 para o AJ-SR04M, 3 para o ZJ-S201)

## Alimentação

A fonte entrega 5 V. Ligue o positivo da fonte na entrada positiva do buck, no VCC do módulo relé, no VCC do AJ-SR04M, no positivo do sensor de fluxo ZJ-S201 e nos pinos COM dos dois canais do relé.

Ligue o negativo da fonte no negativo de entrada do buck, no GND do ESP32, no GND dos dois módulos MAX6675, no GND do AJ-SR04M, no negativo do ZJ-S201, no GND do módulo relé e nos negativos das duas bombas. Esse é o GND comum de todo o sistema.

Ajuste o buck para 3,3 V antes de conectar o ESP32. Depois ligue a saída positiva de 3,3 V do buck no pino 3V3 do ESP32. Ligue o negativo da saída do buck no GND comum. Não ligue a saída de 3,3 V no VIN e não use os pinos VN ou VP como alimentação. Não alimente o ESP32 pelo USB ao mesmo tempo que pelo buck.

## Termopares (MAX6675)

No primeiro MAX6675, ligue VCC no 3,3 V do buck e GND no GND comum. Ligue SCK no D32, CS no D21 e SO no D27 do ESP32. O primeiro termopar entra nos bornes positivo e negativo desse MAX6675.

No segundo MAX6675, ligue VCC no 3,3 V do buck e GND no GND comum. Ligue SCK no D18, CS no D23 e SO no D22 do ESP32. O segundo termopar entra nos bornes positivo e negativo desse segundo MAX6675.

## Ultrassônico (AJ-SR04M)

Ligue VCC no 5 V da fonte e GND no GND comum. Ligue TRIG diretamente no D25 do ESP32.

O ECHO vai para o divisor de tensão antes de chegar ao D26. Ligue ECHO em um resistor de 10 kΩ. Na outra ponta desse resistor fica o ponto central. Esse ponto central vai para o D26 do ESP32. Desse mesmo ponto central, ligue mais dois resistores de 10 kΩ em série até o GND comum. Assim, o ECHO de 5 V chega ao ESP32 com aproximadamente 3,33 V.

```text
ECHO → 10k → ponto central → D26
                  │
                  └→ 10k → 10k → GND
```

## Sensor de fluxo (ZJ-S201)

Ligue o positivo no 5 V da fonte e o negativo no GND comum. O fio de sinal não vai direto ao ESP32. Ligue o sinal em um resistor de 10 kΩ. Na outra ponta desse resistor fica o ponto central. Esse ponto central vai para o D34 do ESP32. Desse mesmo ponto central, ligue mais dois resistores de 10 kΩ em série até o GND comum.

```text
SINAL → 10k → ponto central → D34
                   │
                   └→ 10k → 10k → GND
```

## Relé e bombas (HW-383)

No módulo relé, ligue VCC no 5 V da fonte e GND no GND comum. Ligue IN1 no D19 e IN2 no D33 do ESP32. K1 e K2 são os nomes dos dois relés na placa.

No canal K1, ligue o positivo de 5 V da fonte no borne COM. Ligue o borne NO no positivo da bomba 1. Ligue o negativo da bomba 1 no GND comum. Deixe NC sem ligação.

No canal K2, ligue o positivo de 5 V da fonte no borne COM. Ligue o borne NO no positivo da bomba 2. Ligue o negativo da bomba 2 no GND comum. Deixe NC sem ligação.

Em cada bomba, coloque um diodo 1N4007 em paralelo. O lado com a faixa vai no positivo da bomba, no mesmo fio que vem do NO do relé. O outro lado vai no negativo da bomba, no mesmo fio que vai para o GND comum.

## Tabela de pinos do ESP32

| Pino | Função |
|---|---|
| 3V3 | Entrada 3,3 V do buck |
| GND | GND comum |
| D32 / D21 / D27 | MAX6675 #1 — SCK / CS / SO |
| D18 / D23 / D22 | MAX6675 #2 — SCK / CS / SO |
| D25 | AJ-SR04M TRIG |
| D26 | AJ-SR04M ECHO (via divisor) |
| D34 | ZJ-S201 sinal (via divisor) |
| D19 | Relé IN1 → bomba 1 |
| D33 | Relé IN2 → bomba 2 |

## Comportamento do firmware

- As bombas começam desligadas ao ligar o ESP32.
- O site envia o comando pela página **Bombas**; o ESP32 aplica o comando em até ~0,5 s.
- Se o ESP32 perder o Wi-Fi ou ficar 3 s sem resposta do servidor, desliga as duas bombas.
- O controle de bombas no site é público (sem senha).

## Teste de bancada antes de ligar as bombas

1. Ligue tudo **sem as bombas** conectadas nos bornes NO.
2. Ao energizar, os LEDs dos relés devem ficar **apagados**. Se acenderem sozinhos, o seu HW-383 é ativo em nível baixo: troque `kRelayActiveLevel` para `LOW` em `firmware/src/main.cpp` e grave de novo.
3. Na página **Bombas**, clique em Ligar/Desligar e confira o clique e o LED de cada relé.
4. Só depois conecte as bombas.
