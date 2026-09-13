// Importiamo la classe universale di BeeLadybug dal file isolato
import { BeeLadybugUniversal } from './BeeLadybugUniversal.js';

const canvas = document.getElementById('appCanvas');
const ctx = canvas.getContext('2d');

// 1. Creiamo delle finte entità di un gioco qualsiasi.
// BeeLadybug leggerà queste proprietà (x, y, width, height, colliding) in tempo reale.
const fintoPlayer = { x: 100, y: 100, width: 40, height: 40, colliding: false };
const fintoOstacolo = { x: 400, y: 200, width: 80, height: 80, colliding: false };

// Mettiamo le entità in un array da dare in pasto al debugger
const entitaDelGioco = [fintoPlayer, fintoOstacolo];

// 2. Inizializziamo BeeLadybug in modalità UNIVERSALE
// Gli passiamo il selettore del canvas, l'array delle entità e il tasto di controllo
const bugger = new BeeLadybugUniversal({
    canvasSelector: '#appCanvas',
    entities: entitaDelGioco,
    toggleKey: 'F2'
});

// Tracciamo il mouse sul canvas per muovere il finto player
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    fintoPlayer.x = e.clientX - rect.left - fintoPlayer.width / 2;
    fintoPlayer.y = e.clientY - rect.top - fintoPlayer.height / 2;
});

// 3. Il Loop di rendering del finto gioco esterno
function loop() {
    // A. Pulizia del Canvas standard
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // B. Logica di finta collisione (AABB molto elementare per il test)
    const isColliding = (
        fintoPlayer.x < fintoOstacolo.x + fintoOstacolo.width &&
        fintoPlayer.x + fintoPlayer.width > fintoOstacolo.x &&
        fintoPlayer.y < fintoOstacolo.y + fintoOstacolo.height &&
        fintoPlayer.y + fintoPlayer.height > fintoOstacolo.y
    );

    fintoPlayer.colliding = isColliding;
    fintoOstacolo.colliding = isColliding;

    // C. Disegno della finta grafica del gioco
    // Nota: Il gioco disegna i suoi oggetti normalmente (in questo caso quadrati blu e viola)
    ctx.fillStyle = '#3498db';
    ctx.fillRect(fintoPlayer.x, fintoPlayer.y, fintoPlayer.width, fintoPlayer.height);

    ctx.fillStyle = '#9b59b6';
    ctx.fillRect(fintoOstacolo.x, fintoOstacolo.y, fintoOstacolo.width, fintoOstacolo.height);

    // D. LANCIO DI BEE_LADYBUG! 
    // Viene eseguita alla fine del disegno del gioco e sovrappone le hitbox (Verdi/Rosse)
    bugger.updateAndRender();

    requestAnimationFrame(loop);
}

// Avviamo la demo
loop();
