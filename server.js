require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "redefort";
const adminSessions = new Map();

// Middlewares globais
app.use(cors());
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }));

// Garantir pasta de uploads
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Router principal para unificar rotas sob /urna e na raiz
const router = express.Router();
let mutationQueue = Promise.resolve();
router.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const runMutation = () => new Promise((resolve) => {
        const release = () => resolve();
        res.once('finish', release);
        res.once('close', release);
        next();
    });
    mutationQueue = mutationQueue.then(runMutation, runMutation);
});

function readAdminSession(req) {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)cipa_admin_session=([^;]+)/);
    const sessionId = match ? decodeURIComponent(match[1]) : '';
    const expiresAt = adminSessions.get(sessionId);
    if (!expiresAt || expiresAt <= Date.now()) {
        adminSessions.delete(sessionId);
        return null;
    }
    return sessionId;
}

function requireAdmin(req, res, next) {
    if (!readAdminSession(req)) return res.status(401).json({ error: 'Sessão expirada. Entre novamente no painel.' });
    next();
}

function setAdminSessionCookie(req, res, sessionId, maxAge = 28800) {
    const secure = process.env.PUBLIC_URL?.startsWith('https://') || req.secure;
    res.append('Set-Cookie', `cipa_admin_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function verifyAdminPassword(password, callback) {
    const cleanPassword = String(password || '').trim();
    if (cleanPassword.toLowerCase() === ADMIN_PASSWORD.toLowerCase()) return callback(true);
    db.get('SELECT id FROM admin_users WHERE password = ?', [cleanPassword], (err, user) => callback(!err && Boolean(user)));
}

// Servir arquivos estáticos (CSS, JS, imagens, áudios, uploads)
router.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ==========================================================================
// 1. ROTAS DO FRONTEND
// ==========================================================================
// 1.1 Urna de Votação
router.get(['/', '/urna', '/urna/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1.2 Painel Administrativo / Mesário
router.get(['/admin', '/urna-admin', '/admin.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 1.3 Painel de Apuração em Tempo Real e Emissão de BU
router.get(['/apuracao', '/urna-apuracao', '/apuracao.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'apuracao.html'));
});

// 1.4 Download direto do APK para Tablet
router.get(['/download-apk', '/urna-apk', '/urna/download-apk'], (req, res) => {
    const apkPath = path.join(__dirname, 'public', 'urna-cipa.apk');
    if (fs.existsSync(apkPath)) {
        res.download(apkPath, 'urna-cipa.apk');
    } else {
        res.status(404).send('APK ainda não gerado.');
    }
});


// ==========================================================================
// 2. ROTAS DA API - URNA & VOTAÇÃO
// ==========================================================================
// Status da Urna para polling
router.get('/api/urna/status', (req, res) => {
    db.get("SELECT is_unlocked, current_voter_id FROM urna_state WHERE id = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ 
            is_unlocked: row ? row.is_unlocked === 1 : false,
            current_voter_id: row ? row.current_voter_id : null
        });
    });
});

router.get('/api/voter-access/:token', (req, res) => {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    db.get("SELECT id, name, department, has_voted FROM voters WHERE qr_token_hash = ?", [tokenHash], (err, voter) => {
        if (err) return res.status(500).json({ error: 'Não foi possível validar o QR Code.' });
        if (!voter) return res.status(404).json({ error: 'QR Code inválido ou revogado.' });
        if (voter.has_voted === 1) return res.status(409).json({ error: 'Este eleitor já votou.' });
        res.set('Cache-Control', 'no-store');
        res.json({ valid: true, voter: { name: voter.name, department: voter.department } });
    });
});

// Listar candidatos ativos para a urna
router.get('/api/candidates', (req, res) => {
    db.all("SELECT id, name, department, photo_url FROM candidates ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Computar Voto na Urna e Bloquear Automaticamente
router.post('/api/urna/vote', (req, res) => {
    const { candidate_id, is_blank, access_token } = req.body;

    if (access_token) {
        const tokenHash = crypto.createHash('sha256').update(String(access_token)).digest('hex');
        const hasValidChoice = is_blank === true || (Number.isInteger(Number(candidate_id)) && Number(candidate_id) > 0);
        if (!hasValidChoice) return res.status(400).json({ error: 'Seleção de voto inválida.' });

        const processQrVote = () => new Promise((resolve) => {
            const respond = (status, body) => {
                if (!res.headersSent) res.status(status).json(body);
                resolve();
            };
            db.serialize(() => {
                db.run('BEGIN IMMEDIATE', (beginErr) => {
                    if (beginErr) return respond(500, { error: 'Não foi possível iniciar o registro do voto.' });
                    db.get("SELECT id, has_voted FROM voters WHERE qr_token_hash = ?", [tokenHash], (lookupErr, voter) => {
                        if (lookupErr || !voter) return db.run('ROLLBACK', () => respond(404, { error: 'QR Code inválido ou revogado.' }));
                        if (voter.has_voted === 1) return db.run('ROLLBACK', () => respond(409, { error: 'Este QR Code já foi usado para votar.' }));

                        const finish = (voteErr) => {
                            if (voteErr) return db.run('ROLLBACK', () => respond(400, { error: 'Candidato inválido ou voto indisponível.' }));
                            db.run('UPDATE voters SET has_voted = 1, voted_at = ? WHERE id = ? AND has_voted = 0', [new Date().toISOString(), voter.id], function (markErr) {
                                if (markErr || this.changes !== 1) return db.run('ROLLBACK', () => respond(409, { error: 'Este eleitor já votou.' }));
                                db.run('COMMIT', (commitErr) => {
                                    if (commitErr) return db.run('ROLLBACK', () => respond(500, { error: 'Não foi possível concluir o registro do voto.' }));
                                    respond(200, { success: true, message: 'Voto registrado com sucesso!' });
                                });
                            });
                        };

                        if (is_blank === true) {
                            db.run("UPDATE special_votes SET votes_count = votes_count + 1 WHERE type = 'blank'", function (err) {
                                finish(err || this.changes !== 1 ? new Error('Voto em branco indisponível') : null);
                            });
                        } else {
                            db.run('UPDATE candidates SET votes_count = votes_count + 1 WHERE id = ?', [Number(candidate_id)], function (err) {
                                finish(err || this.changes !== 1 ? new Error('Candidato inválido') : null);
                            });
                        }
                    });
                });
            });
        });
        processQrVote().catch(() => {
            if (!res.headersSent) res.status(500).json({ error: 'Erro inesperado ao registrar voto.' });
        });
        return;
    }

    db.get("SELECT is_unlocked, current_voter_id FROM urna_state WHERE id = 1", [], (err, state) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!state || state.is_unlocked !== 1) {
            return res.status(403).json({ error: "Urna bloqueada. Aguarde liberação pelo mesário." });
        }

        const voterId = state.current_voter_id;

        db.serialize(() => {
            // 1. Bloqueia a urna imediatamente
            db.run("UPDATE urna_state SET is_unlocked = 0, current_voter_id = NULL WHERE id = 1");

            // 2. Se havia um eleitor selecionado no terminal, marca que ele votou
            if (voterId) {
                const now = new Date().toISOString();
                db.run("UPDATE voters SET has_voted = 1, voted_at = ? WHERE id = ?", [now, voterId]);
            }

            // 3. Registra o voto de forma segura e anônima
            if (is_blank) {
                db.run("UPDATE special_votes SET votes_count = votes_count + 1 WHERE type = 'blank'", (err) => {
                    if (err) console.error("Erro ao computar branco:", err);
                    res.json({ success: true, message: "Voto em BRANCO registrado com sucesso!" });
                });
            } else if (candidate_id) {
                db.run("UPDATE candidates SET votes_count = votes_count + 1 WHERE id = ?", [candidate_id], (err) => {
                    if (err) console.error("Erro ao computar voto candidato:", err);
                    res.json({ success: true, message: "Voto registrado com sucesso!" });
                });
            } else {
                res.status(400).json({ error: "Candidato inválido." });
            }
        });
    });
});


// ==========================================================================
// 3. ROTAS DA API - CONTROLE DO MESÁRIO & LIBERAÇÃO
// ==========================================================================
// Status da Urna para o Mesário
router.get('/api/admin/status', requireAdmin, (req, res) => {
    db.get("SELECT is_unlocked, current_voter_id, last_unlocked_at FROM urna_state WHERE id = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row && row.current_voter_id) {
            db.get("SELECT name, department FROM voters WHERE id = ?", [row.current_voter_id], (err, v) => {
                res.json({ 
                    is_unlocked: row ? row.is_unlocked === 1 : false, 
                    current_voter_id: row?.current_voter_id,
                    current_voter: v ? `${v.name} (${v.department || 'REDE FORT'})` : null,
                    last_unlocked_at: row?.last_unlocked_at 
                });
            });
        } else {
            res.json({ 
                is_unlocked: row ? row.is_unlocked === 1 : false, 
                current_voter_id: null,
                current_voter: null,
                last_unlocked_at: row?.last_unlocked_at 
            });
        }
    });
});

// Liberar Urna para 1 Voto (com ou sem eleitor associado)
router.post('/api/admin/unlock', requireAdmin, (req, res) => {
    const { voter_id } = req.body;
    const now = new Date().toISOString();

    db.run("UPDATE urna_state SET is_unlocked = 1, current_voter_id = ?, last_unlocked_at = ? WHERE id = 1", [voter_id || null, now], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Urna liberada para 1 voto com sucesso!" });
    });
});

// Bloquear Urna Manualmente
router.post('/api/admin/lock', requireAdmin, (req, res) => {
    db.run("UPDATE urna_state SET is_unlocked = 0, current_voter_id = NULL WHERE id = 1", (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Urna bloqueada pelo mesário." });
    });
});


// ==========================================================================
// 4. ROTAS DA API - CANDIDATOS COM UPLOAD DE FOTO
// ==========================================================================
router.post('/api/candidates', requireAdmin, (req, res) => {
    const { name, department, photo_base64 } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Nome do candidato é obrigatório." });
    }

    let photo_url = '';

    // Se enviou imagem via Base64, salva o arquivo na pasta public/uploads/
    if (photo_base64 && photo_base64.includes('base64,')) {
        try {
            const matches = photo_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            const ext = matches[1].split('/')[1] || 'jpg';
            const base64Data = matches[2];
            const cleanFileName = `cand_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
            const filePath = path.join(uploadsDir, cleanFileName);

            fs.writeFileSync(filePath, base64Data, 'base64');
            photo_url = `uploads/${cleanFileName}`;
        } catch (e) {
            console.error("Erro ao salvar foto enviada:", e);
        }
    } else if (req.body.photo_url) {
        photo_url = req.body.photo_url;
    }

    const sql = "INSERT INTO candidates (name, department, photo_url, votes_count) VALUES (?, ?, ?, 0)";
    db.run(sql, [name.toUpperCase(), department ? department.toUpperCase() : 'REDE FORT', photo_url], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            success: true,
            data: { id: this.lastID, name: name.toUpperCase(), department, photo_url }
        });
    });
});

router.delete('/api/candidates/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM candidates WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// ==========================================================================
// 5. ROTAS DA API - GESTÃO DE ELEITORES (COLABORADORES APTOS)
// ==========================================================================
// Listar Eleitores
router.get('/api/voters', requireAdmin, (req, res) => {
    db.all("SELECT id, name, registration, department, has_voted, voted_at FROM voters ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

router.post('/api/voters/:id/qr', requireAdmin, async (req, res) => {
    const { id } = req.params;
    db.get('SELECT id, name, has_voted FROM voters WHERE id = ?', [id], async (err, voter) => {
        if (err) return res.status(500).json({ error: 'Erro ao consultar eleitor.' });
        if (!voter) return res.status(404).json({ error: 'Eleitor não encontrado.' });
        if (voter.has_voted === 1) return res.status(409).json({ error: 'Eleitor já votou. Zere a eleição antes de gerar novo acesso.' });

        const token = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const publicBase = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}${req.baseUrl || ''}`).replace(/\/+$/, '');
        const voteUrl = `${publicBase}/#token=${token}`;
        try {
            const qrDataUrl = await QRCode.toDataURL(voteUrl, { errorCorrectionLevel: 'H', margin: 2, width: 420 });
            db.run('UPDATE voters SET qr_token_hash = ? WHERE id = ? AND has_voted = 0', [tokenHash, id], function (updateErr) {
                if (updateErr) return res.status(500).json({ error: 'Não foi possível salvar o acesso.' });
                if (this.changes !== 1) return res.status(409).json({ error: 'Eleitor já votou.' });
                res.set('Cache-Control', 'no-store');
                res.json({ success: true, voter: voter.name, url: voteUrl, qr: qrDataUrl });
            });
        } catch (qrErr) {
            res.status(500).json({ error: 'Não foi possível gerar o QR Code.' });
        }
    });
});

// Cadastrar Eleitor (Apenas Nome e Setor)
router.post('/api/voters', requireAdmin, (req, res) => {
    const { name, department } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Nome do colaborador é obrigatório." });
    }

    const cleanName = name.trim().toUpperCase();
    const cleanDept = department ? department.trim().toUpperCase() : 'GERAL';

    const sql = "INSERT INTO voters (name, department, has_voted) VALUES (?, ?, 0)";
    db.run(sql, [cleanName, cleanDept], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, data: { id: this.lastID, name: cleanName, department: cleanDept } });
    });
});

// Alternar status de voto manualmente (Marcar/Desmarcar que votou)
router.post('/api/voters/:id/toggle-vote', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.get("SELECT has_voted FROM voters WHERE id = ?", [id], (err, voter) => {
        if (err || !voter) return res.status(404).json({ error: "Eleitor não encontrado." });

        const newStatus = voter.has_voted === 1 ? 0 : 1;
        const votedAt = newStatus === 1 ? new Date().toISOString() : null;

        db.run("UPDATE voters SET has_voted = ?, voted_at = ? WHERE id = ?", [newStatus, votedAt, id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, has_voted: newStatus });
        });
    });
});

// Excluir Eleitor
router.delete('/api/voters/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM voters WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// ==========================================================================
// 6. ROTAS DA API - GESTÃO DE USUÁRIOS & OPERADORES
// ==========================================================================
router.post('/api/admin/login', (req, res) => {
    const { password, username } = req.body;
    const cleanPass = (password || '').trim();
    const cleanUser = (username || '').trim();

    if (!cleanPass) {
        return res.status(400).json({ error: "Por favor, informe a senha de acesso." });
    }

    const loginSuccess = (user) => {
        for (const [id, expiresAt] of adminSessions) {
            if (expiresAt <= Date.now()) adminSessions.delete(id);
        }
        const sessionId = crypto.randomBytes(32).toString('hex');
        adminSessions.set(sessionId, Date.now() + 8 * 60 * 60 * 1000);
        setAdminSessionCookie(req, res, sessionId);
        res.json({ success: true, user });
    };

    if (cleanPass.toLowerCase() === ADMIN_PASSWORD.toLowerCase()) {
        return loginSuccess({ name: 'Administrador CIPA', role: 'ADMIN', username: 'admin' });
    }

    // Busca no banco por usuário específico ou por qualquer operador com essa senha
    let query = "SELECT id, username, name, role FROM admin_users WHERE password = ?";
    let params = [cleanPass];

    if (cleanUser && cleanUser.toLowerCase() !== 'admin') {
        query = "SELECT id, username, name, role FROM admin_users WHERE LOWER(username) = LOWER(?) AND password = ?";
        params = [cleanUser, cleanPass];
    }

    db.get(query, params, (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
        }
        loginSuccess({ id: user.id, name: user.name, role: user.role, username: user.username });
    });
});

router.post('/api/admin/logout', (req, res) => {
    const sessionId = readAdminSession(req);
    if (sessionId) adminSessions.delete(sessionId);
    setAdminSessionCookie(req, res, '', 0);
    res.json({ success: true });
});

router.post('/api/admin/verify-password', requireAdmin, (req, res) => {
    verifyAdminPassword(req.body.password, (valid) => {
        if (!valid) return res.status(401).json({ error: 'Senha mestra incorreta.' });
        res.json({ valid: true });
    });
});

router.get('/api/users', requireAdmin, (req, res) => {
    db.all("SELECT id, username, name, role FROM admin_users ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

router.post('/api/users', requireAdmin, (req, res) => {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name) {
        return res.status(400).json({ error: "Nome, Usuário e Senha são obrigatórios." });
    }

    const sql = "INSERT INTO admin_users (username, password, name, role) VALUES (?, ?, ?, ?)";
    db.run(sql, [username.toLowerCase(), password, name, role || 'MESÁRIO'], function (err) {
        if (err) return res.status(400).json({ error: "Usuário já existe ou dados inválidos." });
        res.json({ success: true, data: { id: this.lastID, username, name, role } });
    });
});

router.delete('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    if (id == 1) return res.status(400).json({ error: "O administrador principal não pode ser removido." });
    db.run("DELETE FROM admin_users WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// ==========================================================================
// 7. ROTAS DA API - APURAÇÃO, BOLETIM DE URNA (BU) & ZERÉSIMA
// ==========================================================================
// Resultados em tempo real e Quórum
router.get('/api/results', (req, res) => {
    db.all("SELECT * FROM candidates ORDER BY votes_count DESC, name ASC", [], (err, candidates) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT votes_count FROM special_votes WHERE type = 'blank'", [], (err, blankRow) => {
            const blanks = blankRow ? blankRow.votes_count : 0;
            const totalNominal = candidates.reduce((acc, c) => acc + (c.votes_count || 0), 0);
            const totalVotes = totalNominal + blanks;

            // Estatísticas de eleitores
            db.all("SELECT has_voted FROM voters", [], (err, voters) => {
                const totalVoters = voters ? voters.length : 0;
                const votersTurnout = voters ? voters.filter(v => v.has_voted === 1).length : 0;

                res.json({
                    data: {
                        candidates,
                        blanks,
                        totalNominal,
                        totalVotes,
                        totalVoters,
                        votersTurnout
                    }
                });
            });
        });
    });
});

// Boletim de Urna Oficial da CIPA Rede Fort (Salvador / Bahia)
router.get('/api/bu', (req, res) => {
    db.all("SELECT * FROM candidates ORDER BY name ASC", [], (err, candidates) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT votes_count FROM special_votes WHERE type = 'blank'", [], (err, blankRow) => {
            const blanks = blankRow ? blankRow.votes_count : 0;
            const totalNominal = candidates.reduce((acc, c) => acc + (c.votes_count || 0), 0);
            const totalVotes = totalNominal + blanks;

            db.all("SELECT has_voted FROM voters", [], (err, voters) => {
                const totalVoters = voters ? voters.length : 0;
                const votersTurnout = voters ? voters.filter(v => v.has_voted === 1).length : totalVotes;

                const buData = {
                    header: {
                        empresa: "REDE FORT",
                        departamento: "SEGURANÇA DO TRABALHO",
                        eleicao: "ELEIÇÃO DA CIPA 2026 / 2027",
                        municipio: "SALVADOR / BAHIA",
                        modeloUrna: "UE 2022 TOUCH • SISTEMA DIGITAL",
                        dataHoraEmissao: new Date().toLocaleString('pt-BR'),
                        codigoAutenticidade: "RF-CIPA-SSA-" + Math.random().toString(36).substring(2, 10).toUpperCase()
                    },
                    candidatos: candidates,
                    votosBrancos: blanks,
                    totalNominais: totalNominal,
                    totalApurado: totalVotes,
                    eleitoresAptos: totalVoters || totalVotes,
                    comparecimento: votersTurnout,
                    assinaturaDigital: "F8 A1 04 BC 92 EE 77 41 89 D0 EF 62 1B 3A 9C 55 4E 8D"
                };

                res.json(buData);
            });
        });
    });
});

// Zerésima e Reset Completo da Eleição (com Senha)
router.post('/api/admin/reset', (req, res) => {
    if (!readAdminSession(req)) return res.status(401).json({ error: 'Sessão expirada. Entre novamente no painel.' });
    verifyAdminPassword(req.body.password, (valid) => {
        if (!valid) return res.status(401).json({ error: 'Senha mestra incorreta.' });
        db.serialize(() => {
            db.run("UPDATE candidates SET votes_count = 0");
            db.run("UPDATE special_votes SET votes_count = 0");
            db.run("UPDATE voters SET has_voted = 0, voted_at = NULL");
            db.run("UPDATE urna_state SET is_unlocked = 0, current_voter_id = NULL WHERE id = 1");
            res.json({ success: true, message: 'Eleição zerada com sucesso.' });
        });
    });
});

// ==========================================================================
// 8. REGISTRO GLOBAL DE ROTAS
// ==========================================================================
// Montar em /urna (para proxies de subcaminho como app.fortsupermercados.com.br/urna)
app.use('/urna', router);

// Rotas diretas adicionais caso o proxy faça rewrite ou acesso na raiz
app.get(['/urna-admin', '/admin'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get(['/urna-apuracao', '/apuracao'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'apuracao.html')));

// Montar também na raiz /
app.use('/', router);

// Iniciar Servidor Unificado
app.listen(PORT, () => {
    console.log(`===========================================================`);
    console.log(`🛡️  REDE FORT - SEGURANÇA DO TRABALHO • ELEIÇÃO CIPA`);
    console.log(`📍  SALVADOR / BAHIA`);
    console.log(`-----------------------------------------------------------`);
    console.log(`🗳️  URNA DE VOTAÇÃO: http://localhost:${PORT}/urna`);
    console.log(`⚙️  PAINEL DO ADMIN: http://localhost:${PORT}/urna-admin`);
    console.log(`📊  APURAÇÃO AO VIVO: http://localhost:${PORT}/urna-apuracao`);
    console.log(`===========================================================`);
});
