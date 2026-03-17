// Version
const VERSION = '1.0.5';

// Configuration
const CONFIG = {
    clientId: '1d537507d95248e9a3264b0dff4cc552',
    redirectUri: window.location.hostname === '127.0.0.1'
        ? 'http://127.0.0.1:8000/'
        : 'https://djaenecke.github.io/htstr-1up/',
    scopes: [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-modify-playback-state',
        'user-read-playback-state'
    ].join(' ')
};

// PKCE Helper Functions
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, v => chars[v % chars.length]).join('');
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    bytes.forEach(b => str += String.fromCharCode(b));
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
    const hashed = await sha256(verifier);
    return base64urlencode(hashed);
}

// All available editions
const EDITIONS = [
    'hitster-de-aaaa0007', 'hitster-de-aaaa0012', 'hitster-de-aaaa0015',
    'hitster-de-aaaa0019', 'hitster-de-aaaa0025', 'hitster-de-aaaa0026',
    'hitster-de-aaaa0039', 'hitster-de-aaaa0040', 'hitster-de-aaaa0042',
    'hitster-de', 'hitster-fr-aaaa0031', 'hitster-fr', 'hitster-nl',
    'hitster-nordics', 'hitster-pl-aaae0001', 'hitster-hu-aaae0003',
    'hitster-ca-aaad0001'
];

// Human-readable edition names
const EDITION_NAMES = {
    'hitster-de': 'Original (DE)',
    'hitster-de-aaaa0007': 'Schlager Party',
    'hitster-de-aaaa0012': 'Summer Hits',
    'hitster-de-aaaa0015': 'Guilty Pleasures',
    'hitster-de-aaaa0019': 'Bingo',
    'hitster-de-aaaa0025': 'Rock',
    'hitster-de-aaaa0026': 'Movies & TV',
    'hitster-de-aaaa0039': 'Christmas',
    'hitster-de-aaaa0040': 'Celebration',
    'hitster-de-aaaa0042': 'Holiday Mix',
    'hitster-fr': 'Original (FR)',
    'hitster-fr-aaaa0031': 'Chansons FR',
    'hitster-nl': '100% NL',
    'hitster-nordics': 'Nordic',
    'hitster-pl-aaae0001': 'Polish',
    'hitster-hu-aaae0003': 'Hungarian',
    'hitster-ca-aaad0001': 'Canadian'
};

// Card colors (matching the tabletop game)
const CARD_COLORS = ['teal', 'orange', 'magenta', 'purple', 'blue', 'plum', 'yellow', 'red', 'green', 'cyan'];

// App State
const state = {
    accessToken: null,
    player: null,
    deviceId: null,
    cardData: {},           // { 'edition-key': [array of cards] }
    allCards: [],           // Flattened array of all cards from selected editions
    usedCards: new Set(),   // Track used cards by title+artist
    playedTracks: new Set(), // Track played Spotify URIs to avoid same song
    settings: {
        mode: 'easy',       // 'easy' or 'expert'
        duration: 30,
        startPosition: 'start',
        goal: 10,
        timedMode: false,   // Must place before song ends, no pause/replay
        editions: ['hitster-de']
    },
    game: {
        active: false,
        score: 0,
        timeline: [],       // Array of placed cards with years
        currentCard: null,  // Current card being played
        playbackTimer: null,
        playback: {
            startPosition: 0,
            currentPosition: 0,
            totalDuration: 0,
            remainingTime: 0,
            isPlaying: false
        }
    }
};

// DOM Elements
const elements = {};

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    cacheElements();
    loadSettings();

    // Check for OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        const verifier = localStorage.getItem('code_verifier');
        if (verifier) {
            try {
                const token = await exchangeCodeForToken(code, verifier);
                state.accessToken = token.access_token;
                localStorage.setItem('spotify_token', token.access_token);
                localStorage.setItem('spotify_token_expires', Date.now() + token.expires_in * 1000);
                if (token.refresh_token) {
                    localStorage.setItem('spotify_refresh_token', token.refresh_token);
                }
                localStorage.removeItem('code_verifier');
            } catch (e) {
                console.error('Token exchange failed', e);
                showStatus('Login failed', 'error');
            }
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check for existing token
    if (!state.accessToken) {
        const storedToken = localStorage.getItem('spotify_token');
        const expires = localStorage.getItem('spotify_token_expires');
        if (storedToken && expires && Date.now() < parseInt(expires)) {
            state.accessToken = storedToken;
        }
    }

    if (state.accessToken) {
        await initSpotify();
    } else {
        showScreen('login');
    }

    setupEventListeners();
    await loadCardData();
    populateEditionsUI();
}

function cacheElements() {
    elements.loginScreen = document.getElementById('login-screen');
    elements.settingsScreen = document.getElementById('settings-screen');
    elements.gameScreen = document.getElementById('game-screen');
    elements.gameoverScreen = document.getElementById('gameover-screen');
    elements.loginBtn = document.getElementById('login-btn');
    elements.startGameBtn = document.getElementById('start-game-btn');
    elements.logoutBtn = document.getElementById('logout-btn');
    elements.quitGameBtn = document.getElementById('quit-game-btn');
    elements.backToMenuBtn = document.getElementById('back-to-menu-btn');
    elements.playAgainBtn = document.getElementById('play-again-btn');
    elements.backToMenuBtn = document.getElementById('back-to-menu-btn');
    elements.modeSelect = document.getElementById('mode-select');
    elements.durationSelect = document.getElementById('duration-select');
    elements.positionSelect = document.getElementById('position-select');
    elements.goalSelect = document.getElementById('goal-select');
    elements.timedModeCheckbox = document.getElementById('timed-mode');
    elements.editionsContainer = document.getElementById('editions-container');
    elements.scoreDisplay = document.getElementById('score-display');
    elements.cardsPlayed = document.getElementById('cards-played');
    elements.modeDisplay = document.getElementById('mode-display');
    elements.timeline = document.getElementById('timeline');
    elements.currentCard = document.getElementById('current-card');
    elements.timerProgress = document.querySelector('.timer-progress');
    elements.timeDisplay = document.getElementById('time-display');
    elements.playPauseBtn = document.getElementById('play-pause-btn');
    elements.replayBtn = document.getElementById('replay-btn');
    elements.statusMessage = document.getElementById('status-message');
    elements.gameoverTitle = document.getElementById('gameover-title');
    elements.finalScore = document.getElementById('final-score');
    elements.lastCardReveal = document.getElementById('last-card-reveal');
    elements.revealArtist = document.getElementById('reveal-artist');
    elements.revealYear = document.getElementById('reveal-year');
    elements.revealTitle = document.getElementById('reveal-title');
    elements.playerControls = document.getElementById('player-controls');
    elements.refreshBtnLogin = document.getElementById('refresh-btn-login');
    elements.refreshBtnSettings = document.getElementById('refresh-btn-settings');
}

async function exchangeCodeForToken(code, verifier) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CONFIG.clientId,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: CONFIG.redirectUri,
            code_verifier: verifier
        })
    });

    if (!response.ok) {
        throw new Error('Token exchange failed');
    }
    return response.json();
}

function loadSettings() {
    const saved = localStorage.getItem('htstr1up_settings');
    if (saved) {
        Object.assign(state.settings, JSON.parse(saved));
    }
    document.getElementById('version-display').textContent = `v${VERSION}`;
}

function saveSettings() {
    state.settings.mode = elements.modeSelect.value;
    state.settings.duration = parseInt(elements.durationSelect.value) || 30;
    state.settings.startPosition = elements.positionSelect.value;
    state.settings.goal = parseInt(elements.goalSelect.value);
    state.settings.timedMode = elements.timedModeCheckbox.checked;

    // Get selected editions
    const checkboxes = elements.editionsContainer.querySelectorAll('input:checked');
    state.settings.editions = Array.from(checkboxes).map(cb => cb.value);

    localStorage.setItem('htstr1up_settings', JSON.stringify(state.settings));
}

function setupEventListeners() {
    elements.loginBtn.addEventListener('click', login);
    elements.logoutBtn.addEventListener('click', logout);
    elements.startGameBtn.addEventListener('click', startGame);
    elements.quitGameBtn.addEventListener('click', quitGame);
    elements.backToMenuBtn.addEventListener('click', quitGame);
    elements.playAgainBtn.addEventListener('click', startGame);
    elements.backToMenuBtn.addEventListener('click', () => showScreen('settings'));
    elements.playPauseBtn.addEventListener('click', togglePlayPause);
    elements.replayBtn.addEventListener('click', replayTrack);
    elements.refreshBtnLogin.addEventListener('click', reloadApp);
    elements.refreshBtnSettings.addEventListener('click', reloadApp);

    // Enable start button when at least one edition is selected
    elements.editionsContainer.addEventListener('change', () => {
        const anyChecked = elements.editionsContainer.querySelector('input:checked');
        elements.startGameBtn.disabled = !anyChecked;
    });
}

async function reloadApp() {
    try {
        // Clear all caches
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }
        // Unregister all service workers
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(reg => reg.unregister()));
        }
    } catch (e) {
        console.error('Cache clear failed:', e);
    }
    // Navigate to cache-busted URL to force fresh load
    const url = new URL(window.location.href);
    url.searchParams.set('_reload', Date.now());
    window.location.replace(url.href);
}

function showScreen(name) {
    elements.loginScreen.classList.toggle('hidden', name !== 'login');
    elements.settingsScreen.classList.toggle('hidden', name !== 'settings');
    elements.gameScreen.classList.toggle('hidden', name !== 'game');
    elements.gameoverScreen.classList.toggle('hidden', name !== 'gameover');
}

function showStatus(message, type = '') {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = type;
    if (message) {
        setTimeout(() => {
            elements.statusMessage.textContent = '';
            elements.statusMessage.className = '';
        }, 3000);
    }
}

// Spotify Auth
async function login() {
    const verifier = generateRandomString(64);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem('code_verifier', verifier);

    const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: CONFIG.clientId,
        response_type: 'code',
        redirect_uri: CONFIG.redirectUri,
        scope: CONFIG.scopes,
        code_challenge_method: 'S256',
        code_challenge: challenge
    });
    window.location.href = authUrl;
}

function logout() {
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('spotify_token_expires');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('code_verifier');
    state.accessToken = null;
    if (state.player) {
        state.player.disconnect();
    }
    showScreen('login');
}

// Spotify Player
async function initSpotify() {
    showStatus('Connecting to Spotify...');

    window.onSpotifyWebPlaybackSDKReady = () => {
        state.player = new Spotify.Player({
            name: 'Htstr 1UP',
            getOAuthToken: cb => cb(state.accessToken),
            volume: 0.8
        });

        state.player.addListener('ready', ({ device_id }) => {
            state.deviceId = device_id;
            showStatus('Connected to Spotify');
            showScreen('settings');
        });

        state.player.addListener('not_ready', () => {
            showStatus('Device went offline', 'error');
        });

        state.player.addListener('authentication_error', () => {
            showStatus('Authentication failed', 'error');
            logout();
        });

        state.player.addListener('account_error', () => {
            showStatus('Premium account required', 'error');
        });

        state.player.connect();
    };

    if (window.Spotify) {
        window.onSpotifyWebPlaybackSDKReady();
    }
}

// Card Data
async function loadCardData() {
    showStatus('Loading card databases...');
    let totalCards = 0;

    for (const edition of EDITIONS) {
        try {
            const response = await fetch(`data/${edition}.csv`);
            if (!response.ok) continue;

            const text = await response.text();
            const lines = text.trim().split('\n');

            const header = parseCSVLine(lines[0]);
            const colIndex = {};
            header.forEach((col, i) => {
                const name = col.toLowerCase().replace('#', '').trim();
                if (name === 'card') colIndex.card = i;
                if (name === 'title') colIndex.title = i;
                if (name === 'artist') colIndex.artist = i;
                if (name === 'year') colIndex.year = i;
                if (name === 'isrc') colIndex.isrc = i;
            });

            state.cardData[edition] = [];

            for (let i = 1; i < lines.length; i++) {
                const cols = parseCSVLine(lines[i]);
                const cardNum = parseInt(cols[colIndex.card]);
                if (isNaN(cardNum)) continue;

                const year = parseInt(cols[colIndex.year]);
                if (isNaN(year)) continue;

                state.cardData[edition].push({
                    edition: edition,
                    cardNum: cardNum,
                    title: cols[colIndex.title] || '',
                    artist: cols[colIndex.artist] || '',
                    year: year,
                    isrc: colIndex.isrc !== undefined ? cols[colIndex.isrc] : null,
                    color: CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)]
                });
                totalCards++;
            }
        } catch (e) {
            console.warn(`Failed to load ${edition}`, e);
        }
    }
    console.log(`Loaded ${totalCards} cards from ${Object.keys(state.cardData).length} editions`);
    showStatus('');
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

function populateEditionsUI() {
    elements.editionsContainer.innerHTML = '';

    for (const edition of EDITIONS) {
        if (!state.cardData[edition] || state.cardData[edition].length === 0) continue;

        const label = document.createElement('label');
        label.className = 'edition-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = edition;
        checkbox.checked = state.settings.editions.includes(edition);

        const span = document.createElement('span');
        span.textContent = EDITION_NAMES[edition] || edition;

        label.appendChild(checkbox);
        label.appendChild(span);
        elements.editionsContainer.appendChild(label);
    }

    // Update start button state
    const anyChecked = elements.editionsContainer.querySelector('input:checked');
    elements.startGameBtn.disabled = !anyChecked;

    // Restore other settings
    elements.modeSelect.value = state.settings.mode;
    elements.durationSelect.value = state.settings.duration;
    elements.positionSelect.value = state.settings.startPosition;
    elements.goalSelect.value = state.settings.goal;
    elements.timedModeCheckbox.checked = state.settings.timedMode;
}

// Game Logic
function startGame() {
    saveSettings();

    // Build card pool from selected editions
    state.allCards = [];
    for (const edition of state.settings.editions) {
        if (state.cardData[edition]) {
            state.allCards.push(...state.cardData[edition]);
        }
    }

    if (state.allCards.length < 2) {
        showStatus('Not enough cards in selected editions', 'error');
        return;
    }

    // Shuffle
    shuffleArray(state.allCards);

    // Reset game state
    state.usedCards.clear();
    state.playedTracks.clear();
    state.game.active = true;
    state.game.score = 0;
    state.game.timeline = [];
    state.game.currentCard = null;

    // Update UI
    elements.modeDisplay.textContent = state.settings.mode === 'expert' ? 'Expert' : 'Easy';
    elements.modeDisplay.classList.toggle('expert', state.settings.mode === 'expert');
    updateScoreDisplay();

    // Hide controls in timed mode
    elements.playPauseBtn.classList.toggle('hidden', state.settings.timedMode);
    elements.replayBtn.classList.toggle('hidden', state.settings.timedMode);

    showScreen('game');

    // Place initial card
    const startCard = getNextCard();
    startCard.color = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
    state.game.timeline.push(startCard);
    renderTimeline();

    // Start first round
    nextRound();
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function getCardId(card) {
    // Use normalized title+artist to catch duplicates across editions
    return `${card.title.toLowerCase().trim()}|${card.artist.toLowerCase().trim()}`;
}

function getNextCard() {
    // Find a card we haven't used yet (by title+artist to avoid duplicates)
    for (const card of state.allCards) {
        const id = getCardId(card);
        if (!state.usedCards.has(id)) {
            state.usedCards.add(id);
            return { ...card }; // Return a copy
        }
    }
    // All unique songs used - this shouldn't happen normally
    // Return null to signal no more cards available
    return null;
}

function nextRound() {
    // Check win condition
    if (state.settings.goal > 0 && state.game.score >= state.settings.goal) {
        endGame(true);
        return;
    }

    // Get next card
    const card = getNextCard();
    if (!card) {
        // No more unique cards available - player wins!
        endGame(true);
        return;
    }
    card.color = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
    state.game.currentCard = card;

    // Disable transition for instant reset
    elements.currentCard.style.transition = 'none';

    // Reset card to back side with new color (instant, no animation)
    elements.currentCard.className = `game-card card-color-${card.color}`;

    // Set card front data (hidden by back face)
    elements.currentCard.querySelector('.card-artist').textContent = card.artist;
    elements.currentCard.querySelector('.card-year').textContent = card.year;
    elements.currentCard.querySelector('.card-title').textContent = card.title;

    // Force reflow, then re-enable transition
    elements.currentCard.offsetHeight;
    elements.currentCard.style.transition = '';

    // Render timeline with drop zones
    renderTimeline();

    // Search and play
    playCard(card);
}

async function playCard(card) {
    showStatus('Searching...');

    try {
        const track = await searchSpotify(card);
        if (!track) {
            showStatus('Track not found, skipping...', 'error');
            setTimeout(() => nextRound(), 1500);
            return;
        }

        // Skip if this exact Spotify track was already played
        if (state.playedTracks.has(track.uri)) {
            showStatus('Duplicate track, skipping...', 'error');
            setTimeout(() => nextRound(), 1000);
            return;
        }
        state.playedTracks.add(track.uri);

        state.game.currentCard.spotifyUri = track.uri;
        state.game.currentCard.spotifyDuration = track.duration_ms;

        showStatus('');
        await playTrack(track);
    } catch (e) {
        showStatus('Playback error', 'error');
        console.error(e);
    }
}

async function searchSpotify(card) {
    // Try ISRC first
    if (card.isrc) {
        const response = await fetch(`https://api.spotify.com/v1/search?q=isrc:${card.isrc}&type=track&limit=1`, {
            headers: { 'Authorization': `Bearer ${state.accessToken}` }
        });

        if (!response.ok && response.status === 401) {
            logout();
            throw new Error('Auth failed');
        }

        if (response.ok) {
            const data = await response.json();
            if (data.tracks.items[0]) {
                return data.tracks.items[0];
            }
        }
    }

    // Fallback to title + artist
    const query = `track:${card.title} artist:${card.artist}`;
    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, {
        headers: { 'Authorization': `Bearer ${state.accessToken}` }
    });

    if (!response.ok) {
        if (response.status === 401) logout();
        throw new Error('Search failed');
    }

    const data = await response.json();
    return data.tracks.items[0] || null;
}

async function playTrack(track) {
    const isFullSong = state.settings.duration === 0;
    const duration = isFullSong ? track.duration_ms : state.settings.duration * 1000;

    let startPosition = 0;
    if (!isFullSong && track.duration_ms > duration && state.settings.startPosition === 'random') {
        startPosition = Math.floor(Math.random() * (track.duration_ms - duration));
    }

    state.game.playback.startPosition = startPosition;
    state.game.playback.totalDuration = duration;
    state.game.playback.remainingTime = duration;
    state.game.playback.currentPosition = startPosition;

    await startPlaybackAt(track.uri, startPosition, duration);
}

async function startPlaybackAt(uri, position, duration) {
    try {
        await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${state.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [uri],
                position_ms: position
            })
        });

        state.game.playback.isPlaying = true;
        updatePlayPauseButton();

        const startTime = Date.now();
        const circumference = 283;
        const countdownThreshold = 10000;

        if (state.game.playbackTimer) clearInterval(state.game.playbackTimer);

        state.game.playbackTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, duration - elapsed);
            const progress = (state.game.playback.totalDuration - remaining) / state.game.playback.totalDuration;

            state.game.playback.currentPosition = position + elapsed;
            state.game.playback.remainingTime = remaining;

            const offset = circumference * (1 - progress);
            elements.timerProgress.style.strokeDashoffset = offset;
            elements.timeDisplay.textContent = formatTime(remaining);

            if (remaining <= countdownThreshold && remaining > 0) {
                elements.timerProgress.classList.add('countdown');
                elements.playerControls.classList.add('countdown');
            }

            if (remaining <= 0) {
                stopPlayback();
                // In timed mode, if card wasn't placed, game over
                if (state.settings.timedMode && state.game.currentCard && state.game.active) {
                    endGame(false);
                }
            }
        }, 100);

    } catch (e) {
        showStatus('Playback failed', 'error');
        console.error(e);
    }
}

async function stopPlayback() {
    state.game.playback.isPlaying = false;

    if (state.game.playbackTimer) {
        clearInterval(state.game.playbackTimer);
        state.game.playbackTimer = null;
    }

    elements.timerProgress.classList.remove('countdown');
    elements.playerControls.classList.remove('countdown');
    updatePlayPauseButton();

    if (state.player) {
        try {
            await state.player.pause();
        } catch (e) {
            console.error('Pause failed', e);
        }
    }
}

async function togglePlayPause() {
    if (!state.game.currentCard || !state.deviceId) return;

    if (state.game.playback.isPlaying) {
        await stopPlayback();
    } else if (state.game.playback.remainingTime > 0) {
        await startPlaybackAt(
            state.game.currentCard.spotifyUri,
            state.game.playback.currentPosition,
            state.game.playback.remainingTime
        );
    }
}

async function replayTrack() {
    if (!state.game.currentCard || !state.deviceId) return;

    await stopPlayback();

    const duration = state.settings.duration === 0
        ? state.game.currentCard.spotifyDuration
        : state.settings.duration * 1000;

    state.game.playback.totalDuration = duration;
    state.game.playback.remainingTime = duration;
    state.game.playback.currentPosition = state.game.playback.startPosition;

    elements.timerProgress.style.strokeDashoffset = 283;

    await startPlaybackAt(
        state.game.currentCard.spotifyUri,
        state.game.playback.startPosition,
        duration
    );
}

function updatePlayPauseButton() {
    const playIcon = '<svg viewBox="0 0 24 24" class="icon"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>';
    const pauseIcon = '<svg viewBox="0 0 24 24" class="icon"><rect x="4" y="4" width="6" height="16" fill="currentColor"/><rect x="14" y="4" width="6" height="16" fill="currentColor"/></svg>';
    elements.playPauseBtn.innerHTML = state.game.playback.isPlaying ? pauseIcon : playIcon;
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateScoreDisplay() {
    const goal = state.settings.goal === 0 ? '?' : state.settings.goal;
    elements.scoreDisplay.textContent = `${state.game.score} / ${goal}`;

    // Update cards played counter
    const count = state.game.timeline.length;
    elements.cardsPlayed.textContent = `${count} card${count !== 1 ? 's' : ''}`;
}

// Timeline Rendering
function renderTimeline() {
    elements.timeline.innerHTML = '';

    // Sort timeline by year for expert mode
    const sorted = [...state.game.timeline].sort((a, b) => a.year - b.year);

    // In easy mode, only show the last PLACED card (not sorted - it becomes the new "top")
    // In expert mode, show all cards sorted by year
    const cardsToShow = state.settings.mode === 'easy'
        ? [state.game.timeline[state.game.timeline.length - 1]]
        : sorted;

    // Add drop zone at start
    if (state.game.currentCard) {
        elements.timeline.appendChild(createDropZone(0));
    }

    cardsToShow.forEach((card, index) => {
        // Add card
        const cardEl = createTimelineCard(card);
        elements.timeline.appendChild(cardEl);

        // Add drop zone after card (only in expert mode or if there's a current card)
        if (state.game.currentCard) {
            elements.timeline.appendChild(createDropZone(index + 1));
        }
    });

    // Scroll to center
    const container = document.getElementById('timeline-container');
    container.scrollLeft = (elements.timeline.scrollWidth - container.clientWidth) / 2;
}

function createTimelineCard(card) {
    const div = document.createElement('div');
    div.className = `game-card timeline-card flipped card-color-${card.color}`;

    div.innerHTML = `
        <div class="card-face card-front">
            <div class="card-artist">${escapeHtml(card.artist)}</div>
            <div class="card-year">${card.year}</div>
            <div class="card-title">${escapeHtml(card.title)}</div>
        </div>
        <div class="card-face card-back-face"></div>
    `;

    return div;
}

function createDropZone(position) {
    const div = document.createElement('div');
    div.className = 'drop-zone';
    div.dataset.position = position;

    div.addEventListener('click', () => handlePlacement(position));

    return div;
}

function handlePlacement(position) {
    if (!state.game.currentCard || !state.game.active) return;

    stopPlayback();

    const card = state.game.currentCard;

    // Determine if placement is correct
    let correct = false;

    if (state.settings.mode === 'easy') {
        // Easy mode: compare to the last PLACED card (the current "top" card)
        const topCard = state.game.timeline[state.game.timeline.length - 1];
        if (position === 0) {
            // Placed before (left): card must be earlier or same year
            correct = card.year <= topCard.year;
        } else {
            // Placed after (right): card must be later or same year
            correct = card.year >= topCard.year;
        }
    } else {
        // Expert mode: must be in correct position in the sorted timeline
        const sorted = [...state.game.timeline].sort((a, b) => a.year - b.year);
        const yearBefore = position > 0 ? sorted[position - 1].year : -Infinity;
        const yearAfter = position < sorted.length ? sorted[position].year : Infinity;
        correct = card.year >= yearBefore && card.year <= yearAfter;
    }

    // Reveal card
    elements.currentCard.classList.add('flipped');

    if (correct) {
        state.game.score++;
        state.game.timeline.push(card);
        updateScoreDisplay();
        showStatus('Correct!', 'success');

        // Add animation to current card
        elements.currentCard.classList.add('placement-correct');

        setTimeout(() => {
            elements.currentCard.classList.remove('placement-correct');
            state.game.currentCard = null;
            nextRound();
        }, 1000);
    } else {
        showStatus('Wrong!', 'error');
        elements.currentCard.classList.add('placement-wrong');

        setTimeout(() => {
            endGame(false);
        }, 1500);
    }
}

function endGame(won) {
    state.game.active = false;
    stopPlayback();

    elements.gameoverTitle.textContent = won ? 'You Win!' : 'Game Over';
    elements.gameoverTitle.className = won ? 'win' : 'lose';
    elements.finalScore.textContent = state.game.score;

    // Show last card if lost
    if (!won && state.game.currentCard) {
        elements.revealArtist.textContent = state.game.currentCard.artist;
        elements.revealYear.textContent = state.game.currentCard.year;
        elements.revealTitle.textContent = state.game.currentCard.title;
        elements.lastCardReveal.classList.remove('hidden');
    } else {
        elements.lastCardReveal.classList.add('hidden');
    }

    showScreen('gameover');
}

function quitGame() {
    state.game.active = false;
    stopPlayback();
    showScreen('settings');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
}
