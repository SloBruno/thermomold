# Diagnóstico integrado — firmware 0.1.12

Serial USB: 115200 baud. Fonte externa desligada durante USB.

- Enviar `d` nos primeiros 2 s após reset: modo LOCAL, sem Wi-Fi/HTTP/OTA; saídas de relé mantidas em OFF. Temperaturas a cada 500 ms e vazão a cada ~1 s. Não apaga configuração nem calibra.
- Enviar `d` durante operação normal: habilita os logs crus na frequência normal de leitura.
- `q`: silencia logs; não sai do modo local. Reset sem enviar `d`: volta à operação normal.
- `RAW_TEMP`: palavra de 16 bits hex de cada MAX6675, status, temperatura decodificada e corrigida, revisão da calibração. Temperatura associada a status !=0 não deve ser usada.
- `RAW_FLOW`: duração real da janela, todas as bordas de descida (`edges`), bordas aceitas/rejeitadas pelo intervalo mínimo, frequência bruta, vazão filtrada e total de pulsos creditados.

## Ensaio USB, sem rede

Captura `capture_local_0.1.12.txt`: 128 pares com status 0 em ambos. Canal 1: média 9,207 C (8,5–9,75). Canal 2: média 39,066 C (38,25–39,5). Temperaturas antes/depois da calibração iguais; revisão 0. A diferença já está nas palavras retornadas, não em um offset de calibração.

Captura `capture_edges_0.1.12.txt`: comparação experimental da amostragem antes/depois do primeiro pulso. Sequência original: 9,367 e 39,235 C. Com um pulso antes do primeiro bit: 18,75 e 78,57 C, aproximadamente o dobro (deslocamento de bits), sem resolver a diferença. Variante experimental removida da versão final.

Isso NÃO prova sozinho defeito físico nem exclui todo erro no driver. Não foi aplicada compensação artificial de ~30 C. Próximo teste para separar caminho analógico de canal digital: desligar, trocar somente as sondas K entre os bornes dos dois módulos, mantendo SCK/CS/SO e alimentação de cada módulo no lugar; repetir captura com sondas juntas na mesma temperatura. Se a diferença acompanhar a sonda: sonda/polaridade/contatos; se ficar no módulo: investigar módulo e leitura digital com referência independente/analisador lógico.

A vazão apresentou centenas de bordas por segundo mesmo no modo sem rede. Sem confirmação de água passando e da alimentação do sensor durante USB, não atribuir automaticamente a interferência ou a fluxo real.
