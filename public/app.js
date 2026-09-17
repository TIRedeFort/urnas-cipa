const API_URL = '/api';

// ==========================================================================
// 1. SINTETIZADOR DE ÁUDIO OFICIAL DA URNA ELETRÔNICA (WEB AUDIO API)
// ==========================================================================
class UrnaAudio {
    constructor() {
        this.audioCtx = null;
        this.confirmaAudio = new Audio('confirma-urna.mp3');
    }

    init() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        if (this.confirmaAudio) {
            this.confirmaAudio.load();
        }
    }

    playKeyBeep() {
        try {
            this.init();
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(1050, this.audioCtx.currentTime);

            gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.05);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.05);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    playFimSound() {
        try {
            if (this.confirmaAudio) {
                this.confirmaAudio.currentTime = 0;
                this.confirmaAudio.play().catch(e => {
                    console.log("Audio play fallback:", e);
                    this.playFimSynthesized();
                });
            } else {
                this.playFimSynthesized();
            }
        } catch (e) {
            console.error("Audio error:", e);
            this.playFimSynthesized();
        }
    }

    playFimSynthesized() {
        try {
            this.init();
            const now = this.audioCtx.currentTime;

            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc1.type = 'sine';
            osc2.type = 'triangle';

            osc1.frequency.setValueAtTime(1350, now);
            osc2.frequency.setValueAtTime(675, now);

            gain.gain.setValueAtTime(0.4, now);
            gain.gain.setValueAtTime(0.4, now + 1.25);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.45);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc1.start(now);
            osc2.start(now);

            osc1.stop(now + 1.45);
            osc2.stop(now + 1.45);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }
}

const urnaAudio = new UrnaAudio();


// ==========================================================================
// 2. LÓGICA DA URNA ELETRÔNICA (/URNA OU /)
// ==========================================================================
const viewBloqueada = document.getElementById('view-bloqueada');
const viewVotacao = document.getElementById('view-votacao');
const viewConfirmacao = document.getElementById('view-confirmacao');
const viewGravando = document.getElementById('view-gravando');
const viewFim = document.getElementById('view-fim');

const candidatesGrid = document.getElementById('candidates-grid');
const btnSelectBlank = document.getElementById('btn-select-blank');

const confirmCandidateInfo = document.getElementById('confirm-candidate-info');
const confirmBlankInfo = document.getElementById('confirm-blank-info');
const confirmPhotoCol = document.getElementById('confirm-photo-col');
const confirmPhotoImg = document.getElementById('confirm-photo-img');
const confirmName = document.getElementById('confirm-name');
const confirmParty = document.getElementById('confirm-party');
const btnLcdCorrige = document.getElementById('btn-lcd-corrige');
const btnLcdConfirma = document.getElementById('btn-lcd-confirma');

let selectedCandidateForVote = null;
let isBlankVote = false;
let isUrnaCurrentlyUnlocked = false;
let isVotingInProgress = false;

function startUrnaPolling() {
    if (!viewBloqueada) return;

    setInterval(() => {
        if (isVotingInProgress) return;

        fetch(`${API_URL}/urna/status`)
            .then(res => res.json())
            .then(status => {
                if (status.is_unlocked && !isUrnaCurrentlyUnlocked) {
                    isUrnaCurrentlyUnlocked = true;
                    showVotingScreen();
                } else if (!status.is_unlocked && isUrnaCurrentlyUnlocked) {
                    isUrnaCurrentlyUnlocked = false;
                    showLockScreen();
                }
            })
            .catch(err => console.error("Erro no polling da urna:", err));
    }, 600);
}

function showLockScreen() {
    if (viewConfirmacao) viewConfirmacao.classList.add('hidden');
    if (viewVotacao) viewVotacao.classList.add('hidden');
    if (viewGravando) viewGravando.classList.add('hidden');
    if (viewFim) viewFim.classList.add('hidden');
    if (viewBloqueada) viewBloqueada.classList.remove('hidden');
}

function showVotingScreen() {
    if (viewBloqueada) viewBloqueada.classList.add('hidden');
    if (viewConfirmacao) viewConfirmacao.classList.add('hidden');
    if (viewGravando) viewGravando.classList.add('hidden');
    if (viewFim) viewFim.classList.add('hidden');
    if (viewVotacao) viewVotacao.classList.remove('hidden');
    loadCandidatesForUrna();
}

function loadCandidatesForUrna() {
    if (!candidatesGrid) return;

    fetch(`${API_URL}/candidates`)
        .then(res => res.json())
        .then(res => {
            const list = res.data || [];
            candidatesGrid.innerHTML = '';

            if (list.length === 0) {
                candidatesGrid.innerHTML = '<p style="text-align:center; grid-column:1/-1; padding:3rem; font-weight:800;">Nenhum candidato cadastrado para a CIPA.</p>';
                return;
            }

            list.forEach(c => {
                const card = document.createElement('div');
                card.className = 'candidate-select-card';
                card.onclick = () => showConfirmationScreen(c);

                const photoUrl = c.photo_url || 'logo.png';

                card.innerHTML = `
                    <div class="card-photo-wrapper">
                        <img src="${photoUrl}" alt="${c.name}" loading="lazy">
                    </div>
                    <div class="card-info-content">
                        <div>
                            <div class="candidate-card-name">${c.name}</div>
                            <div class="candidate-card-party">${c.department || 'REDE FORT'}</div>
                        </div>
                        <button class="btn-card-select">TOQUE PARA VOTAR</button>
                    </div>
                `;
                candidatesGrid.appendChild(card);
            });
        });
}

function showConfirmationScreen(candidate) {
    urnaAudio.playKeyBeep();
    selectedCandidateForVote = candidate;
    isBlankVote = false;

    if (viewVotacao) viewVotacao.classList.add('hidden');
    if (viewConfirmacao) viewConfirmacao.classList.remove('hidden');

    if (confirmCandidateInfo) confirmCandidateInfo.classList.remove('hidden');
    if (confirmPhotoCol) confirmPhotoCol.classList.remove('hidden');
    if (confirmBlankInfo) confirmBlankInfo.classList.add('hidden');

    if (confirmPhotoImg) confirmPhotoImg.src = candidate.photo_url || 'logo.png';
    if (confirmName) confirmName.textContent = candidate.name;
    if (confirmParty) confirmParty.textContent = candidate.department || 'REDE FORT';
}

if (btnSelectBlank) {
    btnSelectBlank.addEventListener('click', () => {
        urnaAudio.playKeyBeep();
        selectedCandidateForVote = null;
        isBlankVote = true;

        if (viewVotacao) viewVotacao.classList.add('hidden');
        if (viewConfirmacao) viewConfirmacao.classList.remove('hidden');

        if (confirmCandidateInfo) confirmCandidateInfo.classList.add('hidden');
        if (confirmPhotoCol) confirmPhotoCol.classList.add('hidden');
        if (confirmBlankInfo) confirmBlankInfo.classList.remove('hidden');
    });
}

if (btnLcdCorrige) {
    btnLcdCorrige.addEventListener('click', () => {
        urnaAudio.playKeyBeep();
        if (viewConfirmacao) viewConfirmacao.classList.add('hidden');
        if (viewVotacao) viewVotacao.classList.remove('hidden');
        selectedCandidateForVote = null;
        isBlankVote = false;
    });
}

if (btnLcdConfirma) {
    btnLcdConfirma.addEventListener('click', () => {
        isVotingInProgress = true;
        if (viewConfirmacao) viewConfirmacao.classList.add('hidden');
        if (viewGravando) viewGravando.classList.remove('hidden');

        const payload = isBlankVote 
            ? { is_blank: true }
            : { candidate_id: selectedCandidateForVote.id };

        fetch(`${API_URL}/urna/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
                isVotingInProgress = false;
                showLockScreen();
            } else {
                setTimeout(() => {
                    if (viewGravando) viewGravando.classList.add('hidden');
                    if (viewFim) viewFim.classList.remove('hidden');
                    urnaAudio.playFimSound();

                    setTimeout(() => {
                        isVotingInProgress = false;
                        isUrnaCurrentlyUnlocked = false;
                        showLockScreen();
                    }, 3500);
                }, 1000);
            }
        })
        .catch(err => {
            console.error(err);
            alert("Erro ao gravar voto.");
            isVotingInProgress = false;
            showLockScreen();
        });
    });
}

if (viewBloqueada) {
    startUrnaPolling();
}


// ==========================================================================
// 3. LÓGICA DO PAINEL DO MESÁRIO & CADASTROS (/ADMIN)
// ==========================================================================
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginSection = document.getElementById('admin-login-section');
const adminContent = document.getElementById('admin-content');
const btnAdminUnlock = document.getElementById('btn-admin-unlock');
const btnAdminLock = document.getElementById('btn-admin-lock');
const adminStatusIndicator = document.getElementById('admin-urna-status-indicator');
const adminStatusText = document.getElementById('admin-status-text');
const statusHint = document.getElementById('status-hint');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const formAddVoter = document.getElementById('form-add-voter');
const tableVoters = document.getElementById('table-voters');
const filterVoters = document.getElementById('filter-voters');

const formAddCandidate = document.getElementById('form-add-candidate');
const candPhotoFile = document.getElementById('cand-photo-file');
const imgPreview = document.getElementById('img-preview');
const photoPreviewBox = document.getElementById('photo-preview-box');
const fileChosenText = document.getElementById('file-chosen-text');
const tableCandidates = document.getElementById('table-candidates');

let cachedVoters = [];
let candidateBase64Photo = '';

const btnAdminLogout = document.getElementById('btn-admin-logout');

function setAdminLoggedInUI() {
    try {
        if (adminLoginSection) {
            adminLoginSection.classList.add('hidden');
            adminLoginSection.style.display = 'none';
        }
        if (adminContent) {
            adminContent.classList.remove('hidden');
            adminContent.style.display = 'block';
        }
        if (btnAdminLogout) btnAdminLogout.style.display = 'inline-block';
    } catch(e) {
        console.error("UI Switch error:", e);
    }

    try {
        loadAllAdminData();
    } catch(e) {
        console.error("loadAllAdminData error:", e);
    }

    try {
        startAdminPolling();
    } catch(e) {
        console.error("startAdminPolling error:", e);
    }
}

window.adminLogout = function() {
    sessionStorage.removeItem('cipa_admin_logged');
    window.location.reload();
};

window.submitAdminLogin = function(e) {
    if (e) e.preventDefault();
    const passInput = document.getElementById('admin-password');
    const password = passInput ? passInput.value.trim() : '';

    if (!password) {
        alert('Por favor, informe a senha de acesso.');
        if (passInput) passInput.focus();
        return;
    }

    fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            sessionStorage.setItem('cipa_admin_logged', 'true');
            setAdminLoggedInUI();
        } else {
            alert(data.error || 'Senha incorreta! Senha padrão: redefort');
            if (passInput) {
                passInput.value = '';
                passInput.focus();
            }
        }
    })
    .catch(err => {
        console.error("Erro no login:", err);
        alert('Erro de conexão com o servidor.');
    });
};

if (adminLoginForm) {
    if (sessionStorage.getItem('cipa_admin_logged') === 'true') {
        setAdminLoggedInUI();
    }

    adminLoginForm.addEventListener('submit', window.submitAdminLogin);
}

// 3.2 Abas de Navegação
if (tabBtns) {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.add('hidden'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.remove('hidden');
        });
    });
}

function loadAllAdminData() {
    loadVotersTable();
    loadCandidatesAdminTable();
    checkAdminUrnaStatus();
}

function startAdminPolling() {
    setInterval(() => {
        checkAdminUrnaStatus();
    }, 800);
}

function checkAdminUrnaStatus() {
    if (!adminStatusIndicator) return;

    fetch(`${API_URL}/admin/status`)
        .then(res => res.json())
        .then(status => {
            if (status.is_unlocked) {
                adminStatusIndicator.className = 'status-box status-unlocked';
                adminStatusText.textContent = '🟢 URNA LIBERADA PARA 1 VOTO';
                if (statusHint) statusHint.textContent = 'A urna está liberada. Assim que o eleitor confirmar o voto, ela bloqueará automaticamente.';
                if (btnAdminUnlock) btnAdminUnlock.disabled = true;
                if (btnAdminLock) btnAdminLock.classList.remove('hidden');
            } else {
                adminStatusIndicator.className = 'status-box status-locked';
                adminStatusText.textContent = '🔴 URNA BLOQUEADA (AGUARDANDO PRÓXIMO ELEITOR)';
                if (statusHint) statusHint.textContent = 'Clique no botão ao lado para habilitar a tela da urna para o próximo colaborador.';
                if (btnAdminUnlock) btnAdminUnlock.disabled = false;
                if (btnAdminLock) btnAdminLock.classList.add('hidden');
            }
        })
        .catch(err => console.error("Erro no status da urna:", err));
}

// 3.3 Liberar / Bloquear Urna
if (btnAdminUnlock) {
    btnAdminUnlock.addEventListener('click', () => {
        fetch(`${API_URL}/admin/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voter_id: null })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                checkAdminUrnaStatus();
            }
        });
    });
}

if (btnAdminLock) {
    btnAdminLock.addEventListener('click', () => {
        fetch(`${API_URL}/admin/lock`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    checkAdminUrnaStatus();
                }
            });
    });
}

// 3.4 Gestão de Eleitores
function loadVotersTable() {
    if (!tableVoters) return;

    fetch(`${API_URL}/voters`)
        .then(res => res.json())
        .then(res => {
            cachedVoters = res.data || [];
            renderVoters(cachedVoters);
            const countElem = document.getElementById('count-eleitores');
            if (countElem) countElem.textContent = cachedVoters.length;
        });
}

function renderVoters(voters) {
    if (!tableVoters) return;
    const tbody = tableVoters.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (voters.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem;">Nenhum eleitor encontrado.</td></tr>';
        return;
    }

    voters.forEach(v => {
        const tr = document.createElement('tr');
        const statusBadge = v.has_voted === 1 
            ? '<span class="badge-voted">✓ VOTOU</span>' 
            : '<span class="badge-not-voted">NÃO VOTOU</span>';

        const toggleBtnText = v.has_voted === 1 ? 'Desmarcar' : 'Marcar Voto';

        tr.innerHTML = `
            <td><strong>${v.name}</strong></td>
            <td>${v.department || '-'}</td>
            <td>${statusBadge}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button class="btn-toggle-vote" onclick="toggleVoterStatus(${v.id})">${toggleBtnText}</button>
                    <button class="btn-delete-item" onclick="deleteVoter(${v.id})">Excluir</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

if (filterVoters) {
    filterVoters.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const filtered = cachedVoters.filter(v => 
            v.name.toLowerCase().includes(term) || 
            (v.department && v.department.toLowerCase().includes(term))
        );
        renderVoters(filtered);
    });
}

if (formAddVoter) {
    formAddVoter.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('voter-name');
        const deptInput = document.getElementById('voter-dept');
        const name = nameInput ? nameInput.value : '';
        const department = deptInput ? deptInput.value : '';

        if (!name.trim()) {
            alert('Por favor, digite o nome do colaborador.');
            return;
        }

        fetch(`${API_URL}/voters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, department })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Eleitor ${data.data.name} cadastrado com sucesso!`);
                formAddVoter.reset();
                loadVotersTable();
            } else {
                alert(data.error || 'Erro ao cadastrar eleitor.');
            }
        })
        .catch(err => alert('Erro de conexão ao cadastrar eleitor.'));
    });
}

window.toggleVoterStatus = function(id) {
    fetch(`${API_URL}/voters/${id}/toggle-vote`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                loadVotersTable();
            }
        });
};

window.deleteVoter = function(id) {
    if (!confirm("Deseja realmente remover este eleitor?")) return;
    fetch(`${API_URL}/voters/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => loadVotersTable());
};

// 3.5 Gestão de Candidatos com Upload Real de Imagem
function handleFileSelection(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('Por favor, selecione apenas arquivos de imagem (PNG, JPG, JPEG, WEBP).');
        return;
    }

    if (fileChosenText) fileChosenText.textContent = `Foto selecionada: ${file.name}`;
    const reader = new FileReader();
    reader.onload = (event) => {
        candidateBase64Photo = event.target.result;
        if (imgPreview) imgPreview.src = candidateBase64Photo;
        if (photoPreviewBox) photoPreviewBox.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

if (candPhotoFile) {
    candPhotoFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        handleFileSelection(file);
    });
}

// Drag & Drop no box de upload
const dropZonePhoto = document.getElementById('drop-zone-photo');
if (dropZonePhoto) {
    dropZonePhoto.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZonePhoto.style.borderColor = 'var(--fort-red)';
        dropZonePhoto.style.backgroundColor = '#fff5f5';
    });

    dropZonePhoto.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZonePhoto.style.borderColor = '#cbd5e1';
        dropZonePhoto.style.backgroundColor = '#f8fafc';
    });

    dropZonePhoto.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZonePhoto.style.borderColor = '#cbd5e1';
        dropZonePhoto.style.backgroundColor = '#f8fafc';
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });
}

window.removeCandidatePhoto = function() {
    candidateBase64Photo = '';
    if (candPhotoFile) candPhotoFile.value = '';
    if (imgPreview) imgPreview.src = '';
    if (photoPreviewBox) photoPreviewBox.classList.add('hidden');
    if (fileChosenText) fileChosenText.textContent = 'Ou arraste e solte uma imagem aqui (JPG, PNG)';
};

if (formAddCandidate) {
    formAddCandidate.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('cand-name').value;
        const department = document.getElementById('cand-dept').value;

        const payload = {
            name,
            department,
            photo_base64: candidateBase64Photo
        };

        fetch(`${API_URL}/candidates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Candidato ${name} cadastrado com sucesso!`);
                formAddCandidate.reset();
                candidateBase64Photo = '';
                if (photoPreviewBox) photoPreviewBox.classList.add('hidden');
                if (fileChosenText) fileChosenText.textContent = 'Clique para selecionar imagem (JPG, PNG)';
                loadCandidatesAdminTable();
            } else {
                alert(data.error || 'Erro ao cadastrar candidato.');
            }
        });
    });
}

function loadCandidatesAdminTable() {
    if (!tableCandidates) return;

    fetch(`${API_URL}/candidates`)
        .then(res => res.json())
        .then(res => {
            const list = res.data || [];
            const tbody = tableCandidates.querySelector('tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const countElem = document.getElementById('count-candidatos');
            if (countElem) countElem.textContent = list.length;

            if (list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem;">Nenhum candidato cadastrado.</td></tr>';
                return;
            }

            list.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><img src="${c.photo_url || 'logo.png'}" style="width:40px; height:50px; object-fit:cover; border-radius:4px; border:1px solid #cbd5e1;"></td>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.department || '-'}</td>
                    <td>
                        <button class="btn-delete-item" onclick="deleteCandidateAdmin(${c.id})">Excluir</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        });
}

window.deleteCandidateAdmin = function(id) {
    if (!confirm("Deseja realmente excluir este candidato da CIPA?")) return;
    fetch(`${API_URL}/candidates/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => loadCandidatesAdminTable());
};


// ==========================================================================
// 4. LÓGICA DA APURAÇÃO EM TEMPO REAL (/APURACAO)
// ==========================================================================
const statTotalVotes = document.getElementById('stat-total-votes');
const statTotalVoters = document.getElementById('stat-total-voters');
const statTurnout = document.getElementById('stat-turnout');
const statTurnoutDetail = document.getElementById('stat-turnout-detail');
const statBlankVotes = document.getElementById('stat-blank-votes');
const statBlankPct = document.getElementById('stat-blank-pct');
const candidatesResultsList = document.getElementById('candidates-results-list');

function loadLiveApuracao() {
    if (!statTotalVotes) return;

    fetch(`${API_URL}/results`)
        .then(res => res.json())
        .then(res => {
            const data = res.data;
            if (!data) return;

            const totalVotes = data.totalVotes || 0;
            const totalVoters = data.totalVoters || 0;
            const votersTurnout = data.votersTurnout || totalVotes;
            const blankVotes = data.blanks || 0;

            const turnoutPct = totalVoters > 0 ? ((votersTurnout / totalVoters) * 100).toFixed(1) : 0;
            const blankPct = totalVotes > 0 ? ((blankVotes / totalVotes) * 100).toFixed(1) : 0;

            statTotalVotes.textContent = totalVotes;
            statTotalVoters.textContent = totalVoters;
            statTurnout.textContent = `${turnoutPct}%`;
            statTurnoutDetail.textContent = `${votersTurnout} de ${totalVoters} votaram`;
            statBlankVotes.textContent = blankVotes;
            statBlankPct.textContent = `${blankPct}% do total`;

            if (candidatesResultsList && data.candidates) {
                candidatesResultsList.innerHTML = '';

                if (data.candidates.length === 0) {
                    candidatesResultsList.innerHTML = '<p style="text-align:center; padding:2rem; font-weight:700;">Nenhum candidato registrado na CIPA.</p>';
                    return;
                }

                data.candidates.forEach((c, index) => {
                    const pct = totalVotes > 0 ? ((c.votes_count / totalVotes) * 100).toFixed(1) : 0;
                    const row = document.createElement('div');
                    row.className = 'candidate-result-row';

                    row.innerHTML = `
                        <div style="font-size: 1.2rem; font-weight: 900; color: #475569; width: 30px;">#${index + 1}</div>
                        <img src="${c.photo_url || 'logo.png'}" class="result-photo-mini" alt="${c.name}">
                        <div class="result-progress-wrap">
                            <div class="result-info-header">
                                <span>${c.name} <small style="color:#64748b; font-weight:600;">(${c.department})</small></span>
                                <span style="color:var(--fort-red);">${c.votes_count} votos (${pct}%)</span>
                            </div>
                            <div class="result-bar-bg">
                                <div class="result-bar-fill" style="width: ${pct}%;"></div>
                            </div>
                        </div>
                    `;
                    candidatesResultsList.appendChild(row);
                });

                // Linha de Votos em Branco
                const blankRow = document.createElement('div');
                blankRow.className = 'candidate-result-row';
                blankRow.style.background = '#ffffff';
                blankRow.innerHTML = `
                    <div style="font-size: 1.2rem; font-weight: 900; color: #94a3b8; width: 30px;">-</div>
                    <div style="width:50px; height:65px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">⬜</div>
                    <div class="result-progress-wrap">
                        <div class="result-info-header">
                            <span>VOTOS EM BRANCO</span>
                            <span style="color:#64748b;">${blankVotes} votos (${blankPct}%)</span>
                        </div>
                        <div class="result-bar-bg">
                            <div class="result-bar-fill" style="width: ${blankPct}%; background:#94a3b8;"></div>
                        </div>
                    </div>
                `;
                candidatesResultsList.appendChild(blankRow);
            }
        })
        .catch(err => console.error("Erro na apuração ao vivo:", err));
}

if (statTotalVotes) {
    loadLiveApuracao();
    setInterval(loadLiveApuracao, 1500);
}

// 4.1 Boletim de Urna (BU) Oficial CIPA Rede Fort (Salvador/BA) - Impressão Perfeita em 1 Página
window.printBuDocument = function(bu) {
    const totalVotes = bu.totalApurado || 0;
    const totalVoters = bu.eleitoresAptos || totalVotes;
    const turnout = bu.comparecimento || totalVotes;
    const abstencao = Math.max(0, totalVoters - turnout);

    let candRows = '';
    if (bu.candidatos && bu.candidatos.length > 0) {
        bu.candidatos.forEach((c, idx) => {
            const pct = totalVotes > 0 ? ((c.votes_count / totalVotes) * 100).toFixed(1) : '0.0';
            candRows += `
                <tr>
                    <td style="padding: 5px 8px; border: 1px solid #000; font-weight: bold;">${idx + 1}. ${c.name}</td>
                    <td style="padding: 5px 8px; border: 1px solid #000;">${c.department || 'REDE FORT'}</td>
                    <td style="padding: 5px 8px; border: 1px solid #000; text-align: right; font-weight: bold;">${c.votes_count || 0}</td>
                    <td style="padding: 5px 8px; border: 1px solid #000; text-align: right;">${pct}%</td>
                </tr>
            `;
        });
    } else {
        candRows = `<tr><td colspan="4" style="text-align:center; padding:8px; border:1px solid #000;">Nenhum candidato registrado.</td></tr>`;
    }

    const blankPct = totalVotes > 0 ? ((bu.votosBrancos / totalVotes) * 100).toFixed(1) : '0.0';

    const printHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Boletim de Urna - CIPA Rede Fort Salvador</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 8mm 10mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            color: #000;
            background: #ffffff;
            font-size: 10pt;
            line-height: 1.25;
            padding: 6px;
        }
        .bu-print-wrapper {
            border: 2px solid #000;
            padding: 14px 18px;
            max-width: 680px;
            margin: 0 auto;
        }
        .bu-print-header {
            text-align: center;
            border-bottom: 2px solid #000;
            padding-bottom: 8px;
            margin-bottom: 8px;
        }
        .bu-print-logo {
            max-height: 42px;
            margin-bottom: 4px;
        }
        .bu-print-title {
            font-size: 13pt;
            font-weight: 900;
            letter-spacing: 0.5px;
        }
        .bu-print-sub {
            font-size: 10.5pt;
            font-weight: bold;
            margin-top: 2px;
        }
        .bu-print-meta {
            font-size: 8.5pt;
            color: #222;
            margin-top: 2px;
        }
        .bu-section-block {
            border-top: 1.5px dashed #000;
            margin-top: 8px;
            padding-top: 6px;
        }
        .bu-section-heading {
            font-size: 10pt;
            font-weight: 900;
            text-align: center;
            margin-bottom: 6px;
            text-transform: uppercase;
        }
        .bu-data-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 3px;
            font-size: 9.5pt;
        }
        .bu-print-table {
            width: 100%;
            border-collapse: collapse;
            margin: 4px 0 6px;
            font-size: 9.5pt;
        }
        .bu-print-table th {
            background: #f0f0f0;
            border: 1px solid #000;
            padding: 4px 6px;
            text-align: left;
            font-weight: bold;
        }
        .bu-print-table td {
            font-size: 9pt;
        }
        .bu-signatures-row {
            margin-top: 20px;
            display: flex;
            justify-content: space-between;
            gap: 12px;
        }
        .bu-sig-item {
            flex: 1;
            text-align: center;
            border-top: 1px solid #000;
            padding-top: 3px;
            font-size: 8pt;
            font-weight: bold;
        }
        .bu-footer-security {
            margin-top: 10px;
            text-align: center;
            font-size: 7.5pt;
            border-top: 1px dashed #000;
            padding-top: 4px;
        }
    </style>
</head>
<body>
    <div class="bu-print-wrapper">
        <div class="bu-print-header">
            <img src="${window.location.origin}/logo.png" alt="Rede Fort" class="bu-print-logo" onerror="this.style.display='none'">
            <div class="bu-print-title">REDE FORT &bull; SEGURANÇA DO TRABALHO</div>
            <div class="bu-print-sub">BOLETIM DE URNA OFICIAL &bull; ELEIÇÃO DA CIPA 2026/2027</div>
            <div class="bu-print-meta">MUNICÍPIO: SALVADOR / BAHIA &bull; UNIDADE MATRIZ</div>
            <div class="bu-print-meta">DATA/HORA EMISSÃO: ${bu.header.dataHoraEmissao}</div>
        </div>

        <div class="bu-section-block">
            <div class="bu-section-heading">DADOS GERAIS DA URNA & QUÓRUM</div>
            <div class="bu-data-row"><span>MODELO DA URNA:</span><strong>URNA ELETRÔNICA TOUCH UE-2022</strong></div>
            <div class="bu-data-row"><span>COLABORADORES APTOS:</span><strong>${totalVoters}</strong></div>
            <div class="bu-data-row"><span>COMPARECIMENTO (VOTANTES):</span><strong>${turnout}</strong></div>
            <div class="bu-data-row"><span>ABSTENÇÕES:</span><strong>${abstencao}</strong></div>
        </div>

        <div class="bu-section-block">
            <div class="bu-section-heading">VOTAÇÃO DOS CANDIDATOS</div>
            <table class="bu-print-table">
                <thead>
                    <tr>
                        <th>Candidato</th>
                        <th>Setor</th>
                        <th style="text-align: right;">Votos</th>
                        <th style="text-align: right;">%</th>
                    </tr>
                </thead>
                <tbody>
                    ${candRows}
                    <tr>
                        <td colspan="2" style="padding: 4px 6px; border: 1px solid #000; font-weight: bold;">VOTOS EM BRANCO</td>
                        <td style="padding: 4px 6px; border: 1px solid #000; text-align: right; font-weight: bold;">${bu.votosBrancos}</td>
                        <td style="padding: 4px 6px; border: 1px solid #000; text-align: right;">${blankPct}%</td>
                    </tr>
                    <tr style="background: #ececec;">
                        <td colspan="2" style="padding: 5px 6px; border: 2px solid #000; font-weight: 900;">TOTAL GERAL APURADO</td>
                        <td colspan="2" style="padding: 5px 6px; border: 2px solid #000; text-align: right; font-weight: 900;">${totalVotes} VOTOS (100%)</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="bu-section-block">
            <div class="bu-section-heading">VALIDAÇÃO DA MESA ELEITORAL</div>
            <div class="bu-signatures-row">
                <div class="bu-sig-item">Presidente da Mesa</div>
                <div class="bu-sig-item">Mesário Responsável</div>
                <div class="bu-sig-item">Fiscal CIPA / Testemunha</div>
            </div>
        </div>

        <div class="bu-footer-security">
            <div>AUTENTICIDADE: <strong>${bu.header.codigoAutenticidade}</strong></div>
            <div>ASSINATURA DIGITAL: <strong>${bu.assinaturaDigital}</strong></div>
        </div>
    </div>
</body>
</html>
    `;

    // Utiliza um iframe invisível para impressão limpa e direta
    let printFrame = document.getElementById('bu-hidden-print-frame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'bu-hidden-print-frame';
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = 'none';
        document.body.appendChild(printFrame);
    }

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(printHtml);
    doc.close();

    setTimeout(() => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
    }, 300);
};

window.openBuModal = function() {
    fetch(`${API_URL}/bu`)
        .then(res => res.json())
        .then(bu => {
            const existingModal = document.getElementById('bu-modal-overlay');
            if (existingModal) existingModal.remove();

            const modal = document.createElement('div');
            modal.className = 'tse-modal-backdrop';
            modal.id = 'bu-modal-overlay';

            let candLines = '';
            if (bu.candidatos && bu.candidatos.length > 0) {
                bu.candidatos.forEach(c => {
                    candLines += `
                        <div class="bu-candidate-row">
                            <span class="bu-cand-name">${c.name} (${c.department})</span>
                            <span class="bu-cand-votes"><strong>${c.votes_count || 0}</strong></span>
                        </div>
                    `;
                });
            } else {
                candLines = '<div style="text-align:center; padding:6px;">Nenhum candidato registrado.</div>';
            }

            modal.innerHTML = `
                <div class="bu-ticket-container" id="bu-print-area">
                    <div class="bu-header">
                        <img src="logo.png" alt="Logo Rede Fort" class="bu-logo" onerror="this.style.display='none'">
                        <div class="bu-org-title">REDE FORT &bull; SEGURANÇA DO TRABALHO</div>
                        <div class="bu-election-title">ELEIÇÃO DA CIPA 2026 / 2027</div>
                        <div class="bu-meta-line">MUNICÍPIO: SALVADOR / BAHIA</div>
                        <div class="bu-meta-line">DATA/HORA: ${bu.header.dataHoraEmissao}</div>
                    </div>

                    <div class="bu-section-title">DADOS GERAIS DA URNA</div>
                    <div class="bu-line">
                        <span>ELEITORES APTOS:</span>
                        <span>${bu.eleitoresAptos}</span>
                    </div>
                    <div class="bu-line">
                        <span>COMPARECIMENTO (VOTANTES):</span>
                        <span>${bu.comparecimento}</span>
                    </div>

                    <div class="bu-section-title">VOTAÇÃO DOS CANDIDATOS</div>
                    ${candLines}

                    <div class="bu-section-title">VOTOS EM BRANCO</div>
                    <div class="bu-line">
                        <span>VOTOS EM BRANCO:</span>
                        <span><strong>${bu.votosBrancos}</strong></span>
                    </div>
                    
                    <div class="bu-line" style="border-top:1px solid #000; padding-top:4px; margin-top:4px; font-weight:900;">
                        <span>TOTAL GERAL APURADO:</span>
                        <span>${bu.totalApurado} VOTOS</span>
                    </div>

                    <div class="bu-footer-box">
                        <div>CÓDIGO DE AUTENTICIDADE:</div>
                        <div style="font-weight:800;">${bu.header.codigoAutenticidade}</div>
                        <div style="margin-top:4px;">ASSINATURA DIGITAL:</div>
                        <div class="bu-hash">${bu.assinaturaDigital}</div>
                    </div>

                    <div class="bu-actions-row">
                        <button id="btn-do-print-bu" class="btn-primary-fort" style="flex:1.4;">🖨️ Imprimir BU (1 Página)</button>
                        <button onclick="document.getElementById('bu-modal-overlay').remove()" class="btn-secondary-lock" style="flex:1;">Fechar</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            document.getElementById('btn-do-print-bu').onclick = () => {
                window.printBuDocument(bu);
            };
        });
};

// 4.2 Zerar Eleição / Zerésima com Senha Mestra (redefort)
window.resetUrnaModal = function() {
    const password = prompt("⚠️ ATENÇÃO: Digite a senha mestra para ZERAR a eleição da CIPA e limpar todos os votos:");
    if (!password) return;

    fetch(`${API_URL}/admin/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(data.message);
            if (typeof loadLiveApuracao === 'function') loadLiveApuracao();
            if (typeof loadAllAdminData === 'function') loadAllAdminData();
        } else {
            alert(data.error || "Erro ao zerar eleição. Senha padrão: redefort");
        }
    });
};

// 4.3 Realizar Contagem dos Votos, Suspense Sério Corporativo e Revelação do Novo Presidente da CIPA
window.iniciarContagemVotos = function() {
    Promise.all([
        fetch(`${API_URL}/voters`).then(r => r.json()),
        fetch(`${API_URL}/results`).then(r => r.json())
    ]).then(([votersRes, resultsRes]) => {
        const voters = votersRes.data || [];
        const results = resultsRes.data || { candidates: [], totalVotes: 0, blanks: 0 };

        const totalVoters = voters.length;
        const votedCount = voters.filter(v => v.has_voted === 1).length;
        const missingVoters = Math.max(0, totalVoters - votedCount);

        if (totalVoters > 0 && missingVoters > 0) {
            const prosseguir = confirm(`⚠️ ATENÇÃO: Faltam ${missingVoters} pessoa(s) para votar.\n\nDeseja encerrar a votação e realizar a apuração agora?`);
            if (!prosseguir) return;

            const senha = prompt(`🔐 Digite a senha mestra para autorizar a apuração final:`);
            if (!senha || (senha.trim().toLowerCase() !== 'redefort' && senha.trim().toLowerCase() !== 'admin' && senha.trim() !== '123456')) {
                alert('Senha incorreta! Apuração cancelada.');
                return;
            }
        } else {
            const senha = prompt(`🔐 Todos os colaboradores já votaram!\n\nDigite a senha mestra para iniciar a apuração dos votos:`);
            if (!senha || (senha.trim().toLowerCase() !== 'redefort' && senha.trim().toLowerCase() !== 'admin' && senha.trim() !== '123456')) {
                alert('Senha incorreta! Apuração cancelada.');
                return;
            }
        }

        // Criar o Modal de Apuração Corporativa Solene
        const existingSuspense = document.getElementById('modal-contagem-suspense');
        if (existingSuspense) existingSuspense.remove();

        const suspenseModal = document.createElement('div');
        suspenseModal.className = 'suspense-modal-backdrop';
        suspenseModal.id = 'modal-contagem-suspense';

        suspenseModal.innerHTML = `
            <div class="suspense-card">
                <div class="suspense-loader-wrap" id="suspense-loader-box">
                    <div class="suspense-radar"></div>
                    <div class="suspense-title">APURAÇÃO OFICIAL DE VOTOS</div>
                    <div class="suspense-status-text" id="suspense-status-msg">Conectando à base de dados da Urna Eletrônica...</div>
                    <div class="suspense-progress-bar">
                        <div class="suspense-progress-fill" id="suspense-progress-bar"></div>
                    </div>
                </div>
                <div id="winner-box-result" class="winner-reveal-wrap hidden"></div>
            </div>
        `;

        document.body.appendChild(suspenseModal);

        const statusMsg = document.getElementById('suspense-status-msg');
        const progressBar = document.getElementById('suspense-progress-bar');
        const loaderBox = document.getElementById('suspense-loader-box');
        const winnerBox = document.getElementById('winner-box-result');

        // Etapas de Apuração com ritmo estendido (~8 segundos)
        setTimeout(() => {
            if (statusMsg) statusMsg.textContent = 'Autenticando chaves de segurança e lacres digitais...';
            if (progressBar) progressBar.style.width = '20%';
            urnaAudio.playKeyBeep();
        }, 1500);

        setTimeout(() => {
            if (statusMsg) statusMsg.textContent = 'Descriptografando e auditando os votos registrados...';
            if (progressBar) progressBar.style.width = '42%';
            urnaAudio.playKeyBeep();
        }, 3100);

        setTimeout(() => {
            if (statusMsg) statusMsg.textContent = 'Contabilizando votos nominais e votos em branco...';
            if (progressBar) progressBar.style.width = '68%';
            urnaAudio.playKeyBeep();
        }, 4700);

        setTimeout(() => {
            if (statusMsg) statusMsg.textContent = 'Validando quórum e consolidando ata da eleição...';
            if (progressBar) progressBar.style.width = '88%';
            urnaAudio.playKeyBeep();
        }, 6300);

        setTimeout(() => {
            if (statusMsg) statusMsg.textContent = 'Finalizando apuração oficial da CIPA 2026/2027...';
            if (progressBar) progressBar.style.width = '100%';
            urnaAudio.playKeyBeep();
        }, 7300);

        // Revelação Oficial e Solene do Resultado
        setTimeout(() => {
            if (loaderBox) loaderBox.classList.add('hidden');
            if (winnerBox) winnerBox.classList.remove('hidden');

            urnaAudio.playFimSound();

            const candidates = results.candidates || [];
            const sortedCandidates = [...candidates].sort((a, b) => (b.votes_count || 0) - (a.votes_count || 0));
            const winner = sortedCandidates[0];
            const totalVotes = results.totalVotes || 0;

            if (!winner || (winner.votes_count === 0 && totalVotes === 0)) {
                winnerBox.innerHTML = `
                    <div style="font-size: 3rem; margin-bottom: 8px;">🗳️</div>
                    <div class="winner-official-seal">HOMOLOGAÇÃO DA ELEIÇÃO</div>
                    <div class="winner-headline">ELEIÇÃO ENCERRADA</div>
                    <div class="winner-subtitle">REDE FORT &bull; SEGURANÇA DO TRABALHO &bull; SALVADOR / BA</div>
                    <p style="font-size: 1rem; color: #475569; margin: 1.5rem 0;">Nenhum voto nominal foi registrado nesta eleição.</p>
                    <div class="winner-actions-group" style="justify-content: center;">
                        <button onclick="document.getElementById('modal-contagem-suspense').remove()" class="btn-primary-fort" style="max-width: 200px;">Fechar</button>
                    </div>
                `;
                return;
            }

            const winPct = totalVotes > 0 ? ((winner.votes_count / totalVotes) * 100).toFixed(1) : '100';
            const winnerPhoto = winner.photo_url || 'logo.png';

            winnerBox.innerHTML = `
                <div class="winner-official-seal">RESULTADO HOMOLOGADO &bull; CIPA 2026/2027</div>
                <div class="winner-headline">PRESIDENTE ELEITO DA CIPA</div>
                <div class="winner-subtitle">REDE FORT COMERCIAL DE ALIMENTOS &bull; SALVADOR / BAHIA</div>

                <div class="winner-photo-frame">
                    <img src="${winnerPhoto}" alt="${winner.name}">
                </div>

                <div class="winner-name">${winner.name}</div>
                <div class="winner-dept">${winner.department || 'REDE FORT'}</div>

                <div>
                    <span class="winner-score-badge">TOTAL: ${winner.votes_count} VOTO(S) (${winPct}% DOS VOTOS)</span>
                </div>

                <div class="winner-actions-group">
                    <button id="btn-winner-emit-bu" class="btn-primary-fort" style="flex: 1.4;">📄 Emitir Boletim de Urna (BU)</button>
                    <button onclick="document.getElementById('modal-contagem-suspense').remove()" class="btn-secondary-lock" style="flex: 1;">Fechar</button>
                </div>
            `;

            const btnBu = document.getElementById('btn-winner-emit-bu');
            if (btnBu) {
                btnBu.onclick = () => {
                    document.getElementById('modal-contagem-suspense').remove();
                    window.openBuModal();
                };
            }
        }, 8000);
    }).catch(err => {
        console.error("Erro ao realizar contagem:", err);
        alert("Erro ao consultar dados da apuração.");
    });
};
