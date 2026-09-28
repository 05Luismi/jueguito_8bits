# 8 BITS KONG

Aventura cooperativa de plataformas de 8 bits. El profesor inicia la partida y varios jugadores comparten la misma aventura online.

## Despliegue online

La página y los enlaces de profesor/jugadores siguen en Vercel. Las conexiones WebSocket del juego se centralizan en un único servidor Node de Render para que todos compartan la misma sala y estado.

1. En Render, crea **New + → Blueprint** y conecta este repositorio.
2. Render leerá `render.yaml` y creará el servicio `jueguito-8bits`.
3. El servicio debe quedar publicado en `https://jueguito-8bits.onrender.com`, que es el servidor WebSocket configurado en `public/client.js`.
4. Vercel mantiene la página. Abre el enlace habitual del profesor; los alumnos entran por el enlace `?player=1` que aparece en el panel.
5. Todos deben usar la página Vercel y conectarse al mismo servidor de Render. El primer acceso a Render puede tardar si el servicio gratuito se ha dormido.

No basta con hacer otro push para sustituir el servidor de juego de Vercel: las instancias de Vercel pueden ser distintas y la partida se guarda en memoria. El servidor persistente de Render mantiene un único estado compartido.

## Jugar en local

1. Ejecuta `INICIAR.bat`, o instala las dependencias con `npm install` y arranca con `npm start`.
2. El profesor abre `http://localhost:3000`.
3. Los jugadores abren la dirección que aparece en el panel, terminada en `/?player=1`.

## Controles

- **A/D** o **flechas izquierda/derecha**: caminar.
- **W/S** o **flechas arriba/abajo**: subir y bajar escaleras.
- **Espacio**: saltar.
- **X**: usar el mazo.
- **M**: activar o silenciar el sonido.

## La aventura

- Cinco niveles con escenarios de distintos colores, escaleras y barriles que ruedan y aceleran.
- Cinco vidas por jugador. Al perder una vida, reaparece al inicio del nivel; al perderlas todas, pasa a espectador.
- Selección de Mario, Luigi, Peach, Daisy, Yoshi, Toad, Toadette, Bowser, Bowser Jr., Donkey Kong, Wario, Waluigi, Rosalina, Pauline y Birdo.
- Cinco colores de traje para cada personaje.
- El equipo avanza cuando quienes siguen en la partida alcanzan la meta.
