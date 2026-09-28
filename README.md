# 8 BITS KONG

Aventura de plataformas cooperativa para jugar en el aula desde el navegador. El profesor inicia la partida y los jugadores se conectan a la misma sala mediante WebSockets.

## Jugar en local

1. Ejecuta `INICIAR.bat`, o instala dependencias con `npm install` y arranca con `npm start`.
2. El profesor abre `http://localhost:3000`.
3. Los jugadores usan el enlace que aparece en el panel o la dirección local terminada en `/?player=1`.
4. Cada jugador elige nombre, personaje y color de traje. El profesor pulsa **EMPEZAR AVENTURA**.

## Controles

- **A/D** o **flechas izquierda/derecha**: caminar.
- **W/S** o **flechas arriba/abajo**: subir o bajar escaleras.
- **Espacio**: saltar.
- **X**: usar el mazo cuando esté disponible.
- **M**: sonido.

## La aventura

- 5 niveles cooperativos con plataformas, escaleras y barriles.
- 5 vidas para cada jugador. Al perder una vida se vuelve al inicio del nivel; al perderlas todas se pasa a espectador.
- Los jugadores pueden elegir entre Mario, Luigi, Peach, Daisy, Yoshi, Toad, Toadette, Bowser, Bowser Jr., Donkey Kong, Wario, Waluigi, Rosalina, Pauline y Birdo.
- Cada personaje puede llevar uno de cinco colores de traje.
- El equipo avanza cuando todos los jugadores que siguen en la partida llegan a la meta. El profesor puede terminarla y devolver a todos a la sala.

## Profesor y despliegue

En una instalación local, abrir desde `localhost` muestra el panel del profesor. Para habilitar un panel remoto, define `TEACHER_KEY` y abre la página con `?teacher=TU_CLAVE`. El enlace `?player=1` siempre entra como jugador.

El juego necesita un servidor que mantenga la partida y sus conexiones WebSocket. En despliegues públicos comparte la URL HTTPS indicada en el panel y comprueba que el proveedor admita WebSockets.
