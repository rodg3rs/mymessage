require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { createClient } = require('@libsql/client');
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let sock;
let estaConectado = false; 

async function conectarWA() {
    // 1. Carrega a sessão do Turso primeiro
    const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    
    // 2. Inicializa o estado (usando /tmp para evitar erros no Render)
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/baileys_auth_v2');
    
    // 3. SE existir no Turso, SOBRESCREVE o estado local
    if (res.rows && res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
        console.log("✅ Dados de conexão aplicados via Turso.");
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

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr && !estaConectado) {
            console.log("⚠️ Nova conexão requerida. QR Code disponível no log.");
        }

        if (connection === 'open') {
            estaConectado = true;
            console.log("✅ WhatsApp ONLINE e pronto para uso!");
        }
        
        if (connection === 'close') {
            estaConectado = false;
            const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReconectar) {
                console.log("🔄 Tentando reconectar em 20s...");
                setTimeout(() => conectarWA(), 20000);
            }
        }
    });
}

// ROTA PARA O BOTÃO
app.post('/api/enviar-oi', async (req, res) => {
    try {
        if (!estaConectado) return res.status(500).json({ success: false, error: "Aguarde a conexão..." });
        await sock.sendMessage("5519981266942@s.whatsapp.net", { text: "Oi! Conexão validada via Turso." });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("🚀 Servidor Online!"));