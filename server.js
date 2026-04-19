require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { createClient } = require('@libsql/client');
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// 1. Configura a pasta pública para servir o HTML corretamente
app.use(express.static(path.join(__dirname, 'public')));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let sock;

async function conectarWA() {
    await db.execute("CREATE TABLE IF NOT EXISTS dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");
    const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    
    // Usamos /tmp para o Render não dar erro de permissão
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_temp');
    
    if (res.rows && res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
        console.log("✅ Sessão carregada do Turso.");
    }

    sock = makeWASocket({ 
       auth: state,
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
        const { connection, qr } = u;
        if (qr) console.log("QR Code disponível (veja log anterior)");
        if (connection === 'open') console.log("✅ WhatsApp Conectado!");
    });
}

// ROTA DE TESTE QUE O SEU BOTÃO VAI CHAMAR
app.post('/api/enviar-oi', async (req, res) => {
    try {
        if (!sock) throw new Error("WhatsApp não inicializado");
        await sock.sendMessage("5519981266942@s.whatsapp.net", { text: "Oi! Teste do Bolão funcionando." });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("🚀 Servidor Online!"));