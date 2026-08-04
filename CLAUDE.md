# CLAUDE.md

Orientações para agentes trabalhando neste repositório. A documentação de uso e a
arquitetura completa (com diagramas) estão no [README](README.md) — leia antes de mexer no
pipeline.

## O que é

App local que analisa a **tessitura vocal** de músicas: baixa do YouTube, isola o vocal com
Demucs, detecta as notas com pYIN e visualiza contra o alcance vocal do usuário. O objetivo
não é medir música em abstrato — é responder *"por que essa música é difícil pra mim?"*.
Toda decisão de produto se resolve por essa pergunta.

Interface e comentários de código em **português brasileiro**. O usuário é brasileiro e a
UI inteira é em pt-BR; mantenha assim, inclusive nomes de nota (o app mostra notação
científica e a portuguesa lado a lado).

## Comandos

```bash
./run.sh                       # sobe em http://127.0.0.1:8420 (PORT muda a porta)
.venv/bin/python -m uvicorn app.main:app --port 8420    # sem o wrapper
uv pip install -r pyproject.toml                        # deps principais
uv pip install "demucs>=4.0.1" "torch>=2.6" "torchaudio>=2.6"   # separação
```

Não existe suíte de testes. A validação é empírica — veja abaixo.

## Como validar mudanças no pipeline

O detector de altura é a parte que mais dá errado silenciosamente: um limiar mal escolhido
não quebra nada, só devolve números musicalmente errados. Antes de aceitar qualquer ajuste:

1. **Sinal sintético.** Gere uma melodia de notas conhecidas com harmônicos e envelope,
   passe por `track_pitch` + `segment_notes` e confira nota a nota. O pipeline atual acerta
   9/9 com desvio de 0 cents.
2. **Áudio real.** Rode em uma música já na biblioteca e compare o histograma com a
   realidade musical: a nota dominante deve bater com o tom detectado, e o núcleo p5–p95
   deve corresponder à tessitura audível do cantor.
3. **Controle negativo.** Rode o mesmo detector no `stems/accompaniment.wav`. Ele *vai*
   detectar notas (o baixo tem altura definida) — o ponto é comparar as ordens de grandeza,
   não esperar zero.
4. **Reanálise barata.** `POST /api/songs/{id}/reanalyze` refaz só o pYIN sobre os stems já
   no disco. Use isso em vez de rebaixar e reseparar (que leva minutos).

Se mudar a forma do `analysis.json`, reanalise a biblioteca inteira — não há migração.

## Armadilhas conhecidas

- **`voiced_prob` não é confiança.** É posterior marginal e vive baixa (mediana ~0,09) mesmo
  em canto claro. O sinal de vozeamento é o `voiced_flag`. Já custou 88% do canto detectado
  uma vez; não reintroduza um limiar alto nela.
- **Extremos precisam de piso de duração.** `min_midi`/`max_midi` saem de alturas com tempo
  acumulado ≥ max(0,3 s, 1% do cantado). Sem isso, um erro de oitava isolado vira a
  manchete. Os brutos ficam em `abs_min_note`/`abs_max_note`.
- **Demucs no MPS pode falhar** dependendo da versão do torch; `separate.py` já cai para CPU
  sozinho. Não remova o fallback.
- **A fila tem 1 worker de propósito** — dois Demucs simultâneos estouram a memória.
- **`compute_stats` pondera por duração**, não por contagem de notas. Percentil de altura
  aqui significa "onde a voz passa X% do *tempo*", que é o que importa para esforço vocal.

## Design da interface

Direção: **painel de instrumento** — a faceplate de um aparelho de áudio, cruzada com a
disciplina redutiva do design modernista brasileiro de discos (Elenco). Escuro por padrão,
grid rigoroso, tipografia geométrica, um acento quente. As escolhas abaixo foram medidas ou
deliberadas; não as reverta por gosto.

**A regra de cor que organiza tudo — três papéis, sem sobreposição:**

| Papel | Como se manifesta | Nunca |
|---|---|---|
| A **sua voz** | superfície iluminada (`--lit` / `--lit-soft`): o chão da medida | vira cor |
| A **música** | tinta: `--voice` azul (ao alcance), `--strain` coral (estoura) | vira fundo |
| **Identidade** | `--lamp` âmbar: marca, aba ativa, foco, botão primário | encosta em dado |

Âmbar como cor de dado **foi testado e reprovado**: ΔE 14,0 contra o coral — indistinguível
até com visão normal. O par azul↔coral passa tudo (ΔE 22,9 protanopia) nos dois temas.
Verde × vermelho para "confortável × difícil" também falha (ΔE 4,1 deuteranopia).

- **A cor nunca carrega significado sozinha.** No piano roll a posição vertical contra a
  faixa acesa já codifica o conforto; a cor reforça. Gráficos com 2+ séries têm legenda, e
  os principais têm visão em tabela.
- **Ênfase em vez de categórico** onde uma série é o assunto: o perfil temporal usa azul
  para a mediana e cinza para o teto, não duas cores concorrentes.
- **Escuro é o padrão do produto**, não a preferência do sistema — não há
  `prefers-color-scheme`. O claro existe em `:root[data-theme="light"]`; ao adicionar um
  token, defina nos dois blocos.
- Gráficos leem cores com `cssVar()` na hora de desenhar, por isso trocar de tema redesenha
  tudo em vez de recarregar.

**Tipografia** (fontes locais do macOS, sem download): `--display` Futura para títulos,
números grandes e o veredito; `--font` Avenir Next para corpo e interface; `--mono` Menlo
para tudo que é leitura de aparelho — nomes de nota, tempos, eixos, células de tabela.
Futura só a partir de ~17px: em corpo pequeno ela perde legibilidade.

**Estrutura:** nada de cards flutuantes. A página é uma pilha de `.register` — faixas
horizontais de largura total separadas por fio de cabelo, o mesmo desenho das linhas de um
piano roll. Dentro de cada uma, grid de duas colunas: `.eyebrow` maiúsculo à esquerda,
conteúdo à direita. Raio zero na moldura; as marcas de dado é que são arredondadas.

**A assinatura** é a régua de registro (`Charts.registerRail`) no cabeçalho: sua voz sempre
à vista, com a música aberta sobreposta. É o argumento do app virado mobília — se for mexer
nela, é isso que está em jogo.

**Movimento:** existe um único momento — as notas entram no sentido do tempo ao abrir uma
música (`PianoRoll.startReveal`). Respeita `prefers-reduced-motion`. Não acrescente outros.

**Armadilha de CSS:** `[hidden] { display: none !important }` está no topo da folha de
propósito. Sem isso, qualquer `display` vindo de classe (`.register.plain`) vence o atributo
`hidden` e o elemento aparece quando não deveria — já aconteceu.

## Notas de implementação

- `notes.py` (Python) e `notes.js` (navegador) duplicam as conversões MIDI de propósito —
  são poucas linhas e evitam um passo de build. Se mudar uma, mude a outra.
- O piano roll é canvas (milhares de marcas, pan/zoom, playhead); os demais gráficos são SVG
  (poucas marcas, hover mais simples). Não unifique.
- `ROLL_GEOM` em `app.js` precisa casar com `GUTTER`/`AXIS_H`/`PAD_T` em `pianoroll.js` —
  é o que alinha o histograma marginal com as linhas do piano roll.
- `download.py` aceita URL **ou** texto livre (vira `ytsearch1:`), e uma busca volta como
  playlist de um item — daí o desempacotamento de `entries`.
- IDs de música são `slug(título)-sha1(chave)[:8]`, onde a chave é a URL ou o caminho
  absoluto. Reanalisar a mesma fonte sobrescreve em vez de duplicar.

## Fora de escopo

Não transforme isto em serviço hospedado. O usuário pediu explicitamente processamento
local; a única saída de rede é o yt-dlp buscando o áudio.
