# 8 BITS BATTLE

Juego de 8 bits para el aula en el que todos luchan contra todos y solo puede quedar uno. El equipo del profesor hace de servidor y los alumnos se conectan por WebSockets desde el navegador.

## Arrancar (equipo del profesor)
1. Doble clic en `INICIAR.bat` (o ejecuta `npm install` y después `npm start`).
2. Se abre `http://localhost:3000`: es el **panel del profesor**. Tu IP sale arriba a la derecha.
3. Los alumnos abren en su navegador `http://TU_IP:3000`, escriben su nombre y pulsan **¡A LUCHAR!**
4. Cuando estén todos, pulsa **EMPEZAR PARTIDA**.

La primera vez, Windows pedirá permiso en el firewall para Node.js: marca **Redes privadas** y acepta.

## Publicar para el aula (Render)
1. En [Render](https://render.com), crea **New + > Blueprint** y conecta este repositorio de GitHub.
2. Selecciona el archivo `render.yaml` y establece un valor largo y privado para `TEACHER_KEY`.
3. Cuando termine el despliegue, Render te dará una URL como `https://jueguito-8bits.onrender.com`.
4. Comparte esa URL con el alumnado. Para abrir el panel del profesor usa `https://jueguito-8bits.onrender.com/?teacher=TU_TEACHER_KEY`.

No compartas la URL que contiene `teacher`, pues permite iniciar y terminar partidas. En el plan gratuito el primer acceso puede tardar unos segundos mientras el servicio se activa.

## Reglas
- 3 vidas y **10 tiros como máximo** por partida.
- A los 25 s la zona roja empieza a cerrarse, y fuera de ella pierdes vida. Así la partida siempre termina, aunque todos se queden sin balas.
- Gana el último que siga vivo. Luego se vuelve a la sala para jugar otra partida.

## Controles
WASD/flechas para moverte · ratón para apuntar · clic o espacio para disparar · M para el sonido

## Ajustes
Están al principio de `server.js`: `MAX_SHOTS`, `MAX_HP`, `SPEED`, `ZONE_DELAY`, `PORT` y el mapa (`MAP`).
