require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { createClient } = require('@libsql/client');
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let sock;
let estaConectando = false; // TRAVA DE SEGURANÇA

async function conectarWA() {
    if (estaConectando) return; // Se já estiver tentando, não inicia outra
    estaConectando = true;

    await db.execute("CREATE TABLE IF NOT EXISTS dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");
    const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    
    // Pasta temporária para o Render
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/baileys_auth_v2');
    
    if (res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
        console.log("✅ Sessão carregada do Turso.");
    }

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ 
       version,
       auth: state,
       printQRInTerminal: false,
       logger: require('pino')({ level: 'silent' }),
       browser: ["Ubuntu", "Chrome", "20.0.04"]
   });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await db.execute({
            sql: "INSERT OR REPLACE INTO dwhatsapp (id, value) VALUES ('session', ?)",
            args: [JSON.stringify(state.creds)]
        });
    });

    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr) {
            console.log("\n--- ESCANEIE O QR CODE ---");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
            estaConectando = false; 
        }

        if (connection === 'open') {
            console.log("✅ WhatsApp Conectado!");
            estaConectando = false;
        }
        
        if (connection === 'close') {
            estaConectando = false;
            const codigoErro = lastDisconnect?.error?.output?.statusCode;
            const deveReconectar = codigoErro !== DisconnectReason.loggedOut;
            
            // Se o erro for "Connection Failure" (408/503), aguardamos mais tempo
            if (deveReconectar) {
                console.log("🔄 Reconexão programada para daqui a 30 segundos...");
                setTimeout(() => conectarWA(), 30000); 
            }
        }
    });
}

// ROTA QUE O SEU HTML PRECISA PARA O TESTE DO "OI"
app.post('/api/enviar-oi', async (req, res) => {
    if (!sock || !sock.user) {
        return res.status(500).json({ success: false, error: "WhatsApp deslogado." });
    }
    try {
        const numeroTeste = "5519981266942@s.whatsapp.net"; 
        await sock.sendMessage(numeroTeste, { text: "Oi" });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("Servidor Online!"));