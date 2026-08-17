const MAX_HISTORY = 60;

let allServers = [];
let updateInterval = null;

let state = {
    main: {
        config: null,
        ping: null,
        status: 'checking',
        history: []
    },
    secondary: {
        config: null,
        ping: null,
        status: 'checking',
        history: []
    }
};

const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;

async function loadServers() {
    if (!invoke) return;
    
    try {
        allServers = await invoke('get_servers');
        
        if (allServers.length > 0) {
            state.main.config = allServers[0];
            document.getElementById('main-name').textContent = state.main.config.name;
            document.getElementById('main-ip').textContent = `${state.main.config.ip}:${state.main.config.port}`;
            document.getElementById('card-main').classList.remove('skeleton');
        }
        
        if (allServers.length > 1) {
            const selector = document.getElementById('secondary-selector');
            selector.innerHTML = '';
            
            for (let i = 1; i < allServers.length; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = allServers[i].name;
                selector.appendChild(option);
            }
            
            document.getElementById('card-secondary').style.display = 'flex';
            document.getElementById('card-secondary').classList.remove('skeleton');
            onSecondaryServerChange();
        }
    } catch (e) {
        console.error("Failed to load servers:", e);
        document.getElementById('last-update').textContent = 'Error loading servers';
    }
}

function onSecondaryServerChange() {
    const selector = document.getElementById('secondary-selector');
    const index = parseInt(selector.value);
    
    if (!isNaN(index) && allServers[index]) {
        const newConfig = allServers[index];
        
        if (!state.secondary.config || state.secondary.config.ip !== newConfig.ip) {
            state.secondary.config = newConfig;
            state.secondary.ping = null;
            state.secondary.status = 'checking';
            state.secondary.history = [];
            
            document.getElementById('secondary-ip').textContent = `${newConfig.ip}:${newConfig.port}`;
            updateDisplay();
            pingServer('secondary');
        }
    }
}

function getPingClass(ping) {
    if (ping === null) return 'ping-nodata';
    if (ping < 50) return 'ping-excellent';
    if (ping < 100) return 'ping-fair';
    return 'ping-poor';
}

function getPingText(ping) {
    if (ping === null) return '-';
    return ping.toFixed(1);
}

function getStatusText(status) {
    switch(status) {
        case 'online': return 'Online';
        case 'offline': return 'Offline';
        case 'checking': return 'Checking...';
        default: return 'Standby';
    }
}

function drawChart(canvasId, history) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Support high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);
    
    if (!history || history.length === 0) return;

    const maxPing = Math.max(...history.map(h => h), 100);
    const minPing = Math.min(...history.filter(h => h > 0), 0);
    const range = Math.max(maxPing - minPing, 1);

    // Create gradient for fill
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(233, 69, 96, 0.2)'); // accent-primary
    gradient.addColorStop(1, 'rgba(233, 69, 96, 0)');

    ctx.beginPath();
    history.forEach((ping, index) => {
        const x = (index / (MAX_HISTORY - 1)) * width;
        const y = height - ((ping - minPing) / range) * (height - 5) - 2;

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    // Draw line
    ctx.strokeStyle = '#e94560'; // accent-primary
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill area
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fillStyle = gradient;
    ctx.fill();
}

function updateServerUI(id, data) {
    if (!data.config) return;

    const pingEl = document.getElementById(`ping-${id}`);
    const dotEl = document.getElementById(`dot-${id}`);
    const statusTextEl = document.getElementById(`status-text-${id}`);

    if (pingEl) {
        pingEl.className = `ping-value ${getPingClass(data.ping)}`;
        pingEl.innerHTML = `${getPingText(data.ping)}<span class="ping-unit">${data.ping !== null ? 'ms' : ''}</span>`;
    }
    if (dotEl) {
        dotEl.className = `status-dot status-${data.status}`;
    }
    if (statusTextEl) {
        statusTextEl.textContent = getStatusText(data.status);
    }

    drawChart(`chart-${id}`, data.history);
}

function updateDisplay() {
    updateServerUI('main', state.main);
    if (state.secondary.config) {
        updateServerUI('secondary', state.secondary);
    }
}

async function pingServer(id) {
    const data = state[id];
    if (!data.config || !invoke) return;

    try {
        const result = await invoke('measure_ping', {
            ip: data.config.ip,
            port: data.config.port
        });

        if (result.success) {
            data.ping = result.ping;
            data.status = 'online';
            data.history.push(result.ping);
            if (data.history.length > MAX_HISTORY) {
                data.history.shift();
            }
        } else {
            data.ping = null;
            data.status = 'offline';
        }
    } catch (e) {
        console.error(`Ping error for ${id}:`, e);
        data.ping = null;
        data.status = 'offline';
    }
    
    updateServerUI(id, data);
}

async function pingAllServers() {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('measuring');

    await Promise.all([
        pingServer('main'),
        state.secondary.config ? pingServer('secondary') : Promise.resolve()
    ]);

    btn.classList.remove('measuring');

    const now = new Date();
    document.getElementById('last-update').textContent = `Last update: ${now.toLocaleTimeString()}`;
}

function manualPing() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = setInterval(pingAllServers, 1000);
    }
    pingAllServers();
}

// Window resize handler for canvas redraw
window.addEventListener('resize', () => {
    drawChart('chart-main', state.main.history);
    if (state.secondary.config) {
        drawChart('chart-secondary', state.secondary.history);
    }
});

async function init() {
    await loadServers();
    updateDisplay();
    pingAllServers();
    updateInterval = setInterval(pingAllServers, 1000);
}

// Wait a brief moment for Tauri API to inject
setTimeout(init, 500);
