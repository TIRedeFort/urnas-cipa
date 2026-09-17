const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Criar conexão com o banco de dados (suporte a variável de ambiente DB_PATH para Docker/Easypanel)
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'urna.db');

// Garantir diretório pai se for um caminho em subpasta/volume
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log(`Conectado ao banco de dados SQLite em: ${dbPath}`);
    }
});

// Inicializar tabelas e migrações
db.serialize(() => {
    // 1. Tabela de Candidatos CIPA
    db.run(`CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        department TEXT,
        party TEXT,
        photo_url TEXT,
        votes_count INTEGER DEFAULT 0
    )`);

    // Migração de colunas em candidates
    db.all("PRAGMA table_info(candidates)", [], (err, cols) => {
        if (!err && cols) {
            const names = cols.map(c => c.name);
            if (!names.includes('department')) {
                db.run("ALTER TABLE candidates ADD COLUMN department TEXT", () => {
                    db.run("UPDATE candidates SET department = party WHERE department IS NULL");
                });
            }
            if (!names.includes('party')) {
                db.run("ALTER TABLE candidates ADD COLUMN party TEXT");
            }
            // Sanitização de caminhos de imagem para compatibilidade com subpastas/Easypanel
            db.run("UPDATE candidates SET photo_url = SUBSTR(photo_url, 2) WHERE photo_url LIKE '/%'");
        }
    });

    // 2. Tabela de Eleitores / Colaboradores Aptos
    db.run(`CREATE TABLE IF NOT EXISTS voters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        registration TEXT UNIQUE,
        department TEXT,
        has_voted INTEGER DEFAULT 0,
        voted_at DATETIME
    )`);

    // 3. Tabela de Usuários / Operadores do Sistema
    db.run(`CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'MESÁRIO'
    )`, () => {
        db.run(`INSERT OR IGNORE INTO admin_users (id, username, password, name, role) VALUES (1, 'admin', 'redefort', 'Administrador CIPA', 'ADMIN')`);
    });

    // 4. Tabela de Estado da Urna
    db.run(`CREATE TABLE IF NOT EXISTS urna_state (
        id INTEGER PRIMARY KEY,
        is_unlocked INTEGER DEFAULT 0,
        current_voter_id INTEGER,
        last_unlocked_at DATETIME
    )`, () => {
        db.run(`INSERT OR IGNORE INTO urna_state (id, is_unlocked) VALUES (1, 0)`);
    });

    // Migração de colunas em urna_state
    db.all("PRAGMA table_info(urna_state)", [], (err, cols) => {
        if (!err && cols) {
            const names = cols.map(c => c.name);
            if (!names.includes('current_voter_id')) {
                db.run("ALTER TABLE urna_state ADD COLUMN current_voter_id INTEGER");
            }
            if (!names.includes('last_unlocked_at')) {
                db.run("ALTER TABLE urna_state ADD COLUMN last_unlocked_at DATETIME");
            }
        }
    });

    // 5. Tabela de Votos Especiais (Brancos)
    db.run(`CREATE TABLE IF NOT EXISTS special_votes (
        type TEXT PRIMARY KEY,
        votes_count INTEGER DEFAULT 0
    )`, () => {
        db.run(`INSERT OR IGNORE INTO special_votes (type, votes_count) VALUES ('blank', 0)`);
    });

    // Popular candidatos iniciais da CIPA se estiver vazio
    db.get("SELECT COUNT(*) as count FROM candidates", (err, row) => {
        if (!err && row && row.count === 0) {
            const defaultCandidates = [
                { name: 'CARLOS SILVA', department: 'LOGÍSTICA & ESTOQUE', photo_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80' },
                { name: 'MARIA SANTOS', department: 'FINANCEIRO & CONTROLADORIA', photo_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=500&auto=format&fit=crop&q=80' },
                { name: 'ROBERTO LIMA', department: 'TECNOLOGIA & MANUTENÇÃO', photo_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&auto=format&fit=crop&q=80' },
                { name: 'ANA PAULA SOUZA', department: 'RECURSOS HUMANOS', photo_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=500&auto=format&fit=crop&q=80' }
            ];

            const stmt = db.prepare("INSERT INTO candidates (name, department, party, photo_url, votes_count) VALUES (?, ?, ?, ?, 0)");
            defaultCandidates.forEach(cand => {
                stmt.run(cand.name, cand.department, cand.department, cand.photo_url);
            });
            stmt.finalize();
        }
    });

    // Popular eleitores de exemplo se estiver vazio
    db.get("SELECT COUNT(*) as count FROM voters", (err, row) => {
        if (!err && row && row.count === 0) {
            const sampleVoters = [
                { name: 'ALEXANDRE PEREIRA', registration: 'RF-1001', department: 'LOGÍSTICA' },
                { name: 'BEATRIZ OLIVEIRA', registration: 'RF-1002', department: 'FINANCEIRO' },
                { name: 'CLAUDIO MENDES', registration: 'RF-1003', department: 'OPERAÇÕES' },
                { name: 'DANIELA COSTA', registration: 'RF-1004', department: 'RECURSOS HUMANOS' },
                { name: 'EDUARDO NOGUEIRA', registration: 'RF-1005', department: 'TECNOLOGIA' },
                { name: 'FERNANDA ALVES', registration: 'RF-1006', department: 'VENDAS' },
                { name: 'GABRIEL SOUZA', registration: 'RF-1007', department: 'ESTOQUE' },
                { name: 'HELENA MARTINS', registration: 'RF-1008', department: 'ADMINISTRATIVO' }
            ];

            const stmt = db.prepare("INSERT INTO voters (name, registration, department, has_voted) VALUES (?, ?, ?, 0)");
            sampleVoters.forEach(v => {
                stmt.run(v.name, v.registration, v.department);
            });
            stmt.finalize();
        }
    });
});

module.exports = db;
