# Pitazo: guía para publicar el sitio

Este paquete tiene la página (`index.html`) y dos funciones de servidor (`functions/api/`) que consultan API-Football. La clave de API vive solo en el servidor y nunca llega al navegador.

## 1. Conseguir la clave
1. Registrate en https://www.api-football.com/ (el plan gratuito no pide tarjeta).
2. En tu panel copiá la API key.
3. Probá con el plan gratuito si te devuelve la Liga Profesional de la temporada actual. El plan gratuito limita las temporadas y las consultas (100 por día). Para un sitio con visitas vas a necesitar un plan pago.

## 2. Publicar en Cloudflare Pages (gratis)
Las funciones de servidor requieren publicar con GitHub o con Wrangler (no alcanza con arrastrar archivos).

Opción A, con GitHub:
1. Creá un repositorio en GitHub y subí el contenido de esta carpeta.
2. En https://dash.cloudflare.com entrá a Workers & Pages, Create, Pages, Connect to Git, y elegí el repositorio.
3. Dejá vacíos el comando de build y el directorio de salida. Deploy.

Opción B, con Wrangler (desde una terminal, dentro de esta carpeta):
    npx wrangler pages deploy . --project-name pitazo

## 3. Cargar la clave como secreto
En Cloudflare: tu proyecto, Settings, Variables and Secrets, agregá:
- Nombre: `API_FOOTBALL_KEY`
- Valor: tu clave (tipo Secret)

Volvé a publicar (Redeploy) para que la tome.

Opcional: si querés forzar una temporada, agregá la variable `SEASON` (por ejemplo `2024`). Útil si tu plan gratuito solo permite temporadas anteriores.

## 4. Dominio y publicidad
- Dominio: en el proyecto, Custom domains.
- Anuncios: cuando Google AdSense apruebe tu dominio, reemplazá los recuadros "Espacio publicitario" de `index.html` por el código de cada anuncio.

## Cómo ahorra consultas
Los resultados de hoy se guardan 60 segundos y los de otros días 10 minutos. La tabla se guarda 10 minutos. Con eso, muchas visitas generan pocas consultas a API-Football.

## Agregar o quitar torneos
Editá la lista `LEAGUES` en `functions/_shared.js` y la lista `LEAGUES`/`ORDER` en `index.html`. Los números son los IDs de API-Football.
