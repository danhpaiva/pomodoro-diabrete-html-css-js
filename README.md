# Pomodemônio

O pomodoro que vira o capeta quando você trabalha demais.

Timer Pomodoro em **HTML + CSS + JavaScript puros** — sem frameworks, sem bundler, sem dependências de build — com um monstrengo pixel-art que **cansa enquanto você foca** e **se recupera nas pausas**. Quanto mais cansado, mais ele vira um demoniozinho: chifres, cauda, olhos e sorriso vão de fofos a demoníacos conforme a energia cai.

Este repositório é o porte para web do projeto original em Python + Pygame ([pomodoro-diabrete](https://github.com/danhpaiva/pomodoro-diabrete)), publicado no GitHub Pages.

---

## Rodando localmente

Não há build step. Basta servir os arquivos estáticos:

```bash
python -m http.server 8080
```

E abrir `http://localhost:8080`.

## Estrutura

```
index.html      # markup + painel (timer, energia, ciclos, botões)
style.css       # tema escuro, cores de acento por fase (foco/pausa)
js/pet.js       # maquina de estados pura (ciclo foco/pausa, energia, humor)
js/app.js       # desenho do bichinho em Canvas 2D + loop principal + UI
```

`js/pet.js` não depende do DOM — é a mesma lógica isolada do `pet.py` original, o que a torna fácil de testar isoladamente se algum dia entrar um test runner.

## Controles

| Ação | Como |
|---|---|
| Iniciar / pausar / avançar de fase | clique no botão principal, clique no bichinho, `Espaço` ou `Enter` |
| Pular fase atual | botão "pular" ou `S` |
| Reiniciar sessão | botão "reiniciar" ou `R` |

## Deploy

Publicado automaticamente no GitHub Pages via GitHub Actions a cada push em `main` — veja [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml). O workflow roda um job de **CI** (validação) antes de liberar o job de **CD** (deploy); deploy só acontece se a validação passar.
