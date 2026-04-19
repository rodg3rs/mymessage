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
    try {
        await db.execute("CREATE TABLE IF NOT EXISTS dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");
        
        // Render exige o uso de /tmp para escrita de arquivos
        const { state, saveCreds } = await useMultiFileAuthState('/tmp/baileys_auth_v4');
        
        const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
        if (res.rows.length > 0) {
            try {
                state.creds = JSON.parse(res.rows[0].value);
                console.log("✅ Sessão carregada do Turso com sucesso.");
            } catch (e) {
                console.log("⚠️ Erro ao processar chave do Turso, ignorando...");
            }
        }

        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({ 
           version,
           auth: state,
           printQRInTerminal: false,
           logger: require('pino')({ level: 'silent' }),
           browser: ["Windows", "Edge", "1.0.0"]
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
            if (qr) {
                console.log("🔗 QR CODE: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            }
            if (connection === 'open') {
                estaConectado = true;
                console.log("✅ WhatsApp ONLINE!");
            }
            if (connection === 'close') {
                estaConectado = false;
                const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (deveReconectar) {
                    console.log("🔄 Tentando reconectar em 20 segundos...");
                    setTimeout(() => conectarWA(), 20000);
                }
            }
        });
    } catch (error) {
        console.error("❌ Erro crítico na inicialização:", error);
        // Não deixa o processo morrer, tenta novamente após erro
        setTimeout(() => conectarWA(), 30000);
    }
}

app.post('/api/enviar-oi', async (req, res) => {
    if (!estaConectado) return res.status(500).json({ success: false, error: "Aguarde a conexão..." });
    try {
        await sock.sendMessage("551981266942@s.whatsapp.net", { text: "Oi" });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("🚀 Servidor Online!"));