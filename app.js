// ============================================
// CRASH DASH - Main Application Logic
// ============================================

console.log('🚀 CRASH DASH app.js loaded!');

// Global data stores
let allSignals = [];
let allMetadata = {};
let tickerLookup = {};
let dashboardStats = {};
let currentSort = { column: 'date', direction: 'desc' };
let dateFilter = '1m'; // 'all', '1m', '3m', '6m', '1y', 'custom' - default 1 month
let customDateRange = { start: null, end: null };
let viewMode = localStorage.getItem('viewMode') || 'compressed'; // 'compressed' or 'full'
let groupedSignals = {}; // Grouped by ticker for compressed mode

console.log('Global variables initialized');

// ============================================
// PENCE-AWARE HELPERS
// ============================================

// Parse Signal_Type to extract base severity and modifiers
function parseSignalType(signalType) {
    if (!signalType) return { baseSeverity: 'UNKNOWN', baseColor: 'YELLOW', isEnhanced: false };
    
    const upper = signalType.toUpperCase();
    const isEnhanced = upper.includes('ENHANCED');
    
    let baseSeverity = 'CRASH ZONE';
    let baseColor = 'YELLOW';
    
    if (upper.includes('ULTRA')) {
        baseSeverity = 'ULTRA';
        baseColor = 'RED';
    } else if (upper.includes('EXTREME')) {
        baseSeverity = 'EXTREME';
        baseColor = 'ORANGE';
    } else if (upper.includes('DEEP')) {
        baseSeverity = 'DEEP';
        baseColor = 'GREEN';
    } else if (upper.includes('CRASH ZONE') || upper.includes('CRASH')) {
        baseSeverity = 'CRASH ZONE';
        baseColor = 'YELLOW';
    }
    
    return { baseSeverity, baseColor, isEnhanced };
}

// Return true if ticker appears to be an LSE ticker (.L)
function isLseTicker(ticker) {
    if (!ticker) return false;
    return String(ticker).toUpperCase().endsWith('.L');
}

// Clean ticker for display (remove .L suffix)
function cleanTickerDisplay(ticker) {
    if (!ticker) return '';
    return String(ticker).replace(/\.L$/i, '');
}

// Safely coerce to number or undefined
function toNumber(v) {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

// Get a price-like field from an object, preferring *_pence when ticker is LSE
// Returns a GBP float (or undefined)
function getPriceFieldForTicker(ticker, obj, fieldName) {
    if (!obj) return undefined;
    const lse = isLseTicker(ticker);
    const penceField = `${fieldName}_pence`;
    if (lse && obj[penceField] !== undefined && obj[penceField] !== null) {
        const p = toNumber(obj[penceField]);
        if (p !== undefined) return p / 100.0;
    }
    const raw = toNumber(obj[fieldName]);
    return raw;
}

// Market cap candidate selection: prefer market_cap_pence or companyInfo current_market_cap_pence
function getMarketCapCandidate(ticker, metadata, tickerInfo) {
    const companyInfo = metadata?.company_info || {};
    // Prefer ticker-level market cap pence
    if (tickerInfo && tickerInfo.market_cap_pence !== undefined && tickerInfo.market_cap_pence !== null) {
        const p = toNumber(tickerInfo.market_cap_pence);
        if (p !== undefined) return p / 100.0;
    }
    // then company-level current market cap pence
    if (companyInfo && companyInfo.current_market_cap_pence !== undefined && companyInfo.current_market_cap_pence !== null) {
        const p = toNumber(companyInfo.current_market_cap_pence);
        if (p !== undefined) return p / 100.0;
    }
    // fallback to already-GPB market cap fields
    if (companyInfo && companyInfo.current_market_cap !== undefined && companyInfo.current_market_cap !== null) {
        const n = toNumber(companyInfo.current_market_cap);
        if (n !== undefined) return n;
    }
    if (tickerInfo && tickerInfo.market_cap !== undefined && tickerInfo.market_cap !== null) {
        const n = toNumber(tickerInfo.market_cap);
        if (n !== undefined) return n;
    }
    return undefined;
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded - starting initialization');
    console.log('Papa Parse available:', typeof Papa !== 'undefined');
    
    // Auto-detect mobile and set compact view
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    if (isMobile && !localStorage.getItem('viewMode')) {
        // Only auto-set if user hasn't manually chosen a view
        viewMode = 'compressed';
        localStorage.setItem('viewMode', 'compressed');
        console.log('📱 Mobile device detected - auto-enabled Compact view');
    }
    
    updateViewModeUI(); // Initialize view mode toggle state
    loadAllData();
    setupEventListeners();
    setupMobileScrollHint();
});

// Auto-hide mobile scroll hint after first user interaction
function setupMobileScrollHint() {
    try {
        const wrapper = document.getElementById('signalsWrapper');
        const hint = document.getElementById('mobileScrollHint');
        if (!wrapper || !hint) return;

        const hideHint = () => {
            hint.style.display = 'none';
            wrapper.removeEventListener('scroll', hideHint);
            wrapper.removeEventListener('touchstart', hideHint);
        };

        // If user scrolls or touches, hide the hint
        wrapper.addEventListener('scroll', hideHint, { passive: true });
        wrapper.addEventListener('touchstart', hideHint, { passive: true });

        // Also hide after 6 seconds automatically
        setTimeout(() => { hint.style.display = 'none'; }, 6000);
    } catch (e) {
        console.warn('Mobile scroll hint setup failed', e);
    }
}

// ============================================
// DATA LOADING
// ============================================

async function loadAllData() {
    try {
        console.log('Starting data load...');
        
        // Cache buster
        const cacheBuster = '?v=' + Date.now();
        
        // Load dashboard stats
        console.log('Loading dashboard stats...');
        const statsResponse = await fetch('data/dashboard_stats.json' + cacheBuster);
        if (!statsResponse.ok) throw new Error('Failed to load dashboard_stats.json');
        dashboardStats = await statsResponse.json();
        console.log('Dashboard stats loaded:', dashboardStats);
        updateStats();
        
        // Load ticker lookup
        console.log('Loading ticker lookup...');
        const lookupResponse = await fetch('data/ticker_lookup.json' + cacheBuster);
        if (!lookupResponse.ok) throw new Error('Failed to load ticker_lookup.json');
        const lookupData = await lookupResponse.json();
        tickerLookup = lookupData.tickers;
        console.log('Ticker lookup loaded:', Object.keys(tickerLookup).length, 'tickers');
        populateFilterDropdowns(lookupData.sectors);
        
        // Load metadata index
        console.log('Loading metadata index...');
        const metadataResponse = await fetch('data/metadata_index.json' + cacheBuster);
        if (!metadataResponse.ok) throw new Error('Failed to load metadata_index.json');
        const metadataIndex = await metadataResponse.json();
        
        // Store metadata for quick lookup
        console.log('Processing metadata index...');
        if (metadataIndex && metadataIndex.tickers) {
            metadataIndex.tickers.forEach(ticker => {
                if (ticker && ticker.ticker) {
                    allMetadata[ticker.ticker] = ticker;
                }
            });
            console.log('Metadata loaded for', Object.keys(allMetadata).length, 'tickers');
        } else {
            console.warn('Metadata index has no tickers array');
        }
        
        // Load signals CSV (now enriched with 49 fields - all original + 28 enriched)
        console.log('Loading enriched signals CSV...');
        Papa.parse('data/signals.csv' + cacheBuster, {
            download: true,
            header: true,
            complete: (results) => {
                console.log('Signals CSV loaded:', results.data.length, 'rows');
                
                // Filter signals (columns already in correct format)
                allSignals = results.data.filter(row => row.Ticker);
                
                // Build enrichment lookup: "TICKER_DATE" -> enriched data
                window.enrichmentLookup = {};
                allSignals.forEach(signal => {
                    const ticker = signal.Ticker;
                    const date = signal.Date;
                    if (ticker && date) {
                        const key = `${ticker}_${date}`;
                        window.enrichmentLookup[key] = {
                            rally_state: signal.rally_state,
                            Rally_Count: parseInt(signal.Rally_Count) || 0,
                            lock_in_reached: (signal.lock_in_reached === 'True' || signal.lock_in_reached === true || signal.lock_in_reached === 'true'),
                            lock_in_date: signal.lock_in_date,
                            distance_from_high_pct: parseFloat(signal.distance_from_high_pct) || 0,
                            split_affected: (signal.split_affected === 'True' || signal.split_affected === true || signal.split_affected === 'true'),
                            best_rally_pct: parseFloat(signal.best_rally_pct) || 0,
                            age_days: parseInt(signal.age_days) || 0
                        };
                    }
                });
                
                console.log('Filtered signals:', allSignals.length);
                console.log('Enrichment lookup:', Object.keys(window.enrichmentLookup).length, 'entries');
                renderSignalsTable();
            },
            error: (error) => {
                console.error('Error loading signals CSV:', error);
                document.getElementById('signalsTableBody').innerHTML = 
                    '<tr><td colspan="8" class="no-results">Error loading signals data</td></tr>';
            }
        });
        
    } catch (error) {
        console.error('Error loading data:', error);
        console.error('Error stack:', error.stack);
        alert('Error loading data: ' + error.message);
    }
}

// ============================================
// LOAD FULL TICKER DETAILS
// ============================================

async function loadTickerDetails(ticker) {
    // Check if we already have full details
    if (allMetadata[ticker] && allMetadata[ticker]._fullDetailsLoaded) {
        return allMetadata[ticker];
    }
    
    try {
        const cacheBuster = '?v=' + Date.now();
        const response = await fetch(`data/tickers/${ticker}.json` + cacheBuster);
        
        if (!response.ok) {
            console.warn(`Could not load details for ${ticker}`);
            return allMetadata[ticker] || {};
        }
        
        const fullDetails = await response.json();
        fullDetails._fullDetailsLoaded = true;
        
        // Merge with existing summary metadata
        allMetadata[ticker] = { ...allMetadata[ticker], ...fullDetails };
        
        return allMetadata[ticker];
    } catch (error) {
        console.error(`Error loading ticker details for ${ticker}:`, error);
        return allMetadata[ticker] || {};
    }
}

// ============================================
// UPDATE STATS CARDS
// ============================================

function updateStats() {
    // Total tickers tracked (from ticker lookup - all LSE AIM tickers)
    const totalTracked = Object.keys(tickerLookup).length || 600;
    document.getElementById('totalTickers').textContent = totalTracked > 600 ? totalTracked : '600+';
    
    // Crash signals generated
    document.getElementById('totalSignals').textContent = dashboardStats.total_signals || 0;
    
    // Purple combos
    document.getElementById('purpleCount').textContent = dashboardStats.signal_colors?.PURPLE || 0;
    document.getElementById('redCount').textContent = dashboardStats.signal_colors?.RED || 0;
    
    // Format last updated with date and time split
    const lastUpdated = dashboardStats.last_updated || dashboardStats.generated || '-';
    if (lastUpdated !== '-') {
        // Parse: "2025-11-16 23:32:29 UTC"
        const parts = lastUpdated.split(' ');
        const date = parts[0]; // "2025-11-16"
        const time = parts[1] || ''; // "23:32:29"
        const displayText = `<span class="date">${date}</span><span class="time">${time} ${parts[2] || ''}</span>`;
        
        const lastUpdateEl = document.getElementById('lastUpdate');
        const headerLastUpdateEl = document.getElementById('headerLastUpdate');
        const headerLastUpdateTimeEl = document.getElementById('headerLastUpdateTime');
        const footerLastUpdateEl = document.getElementById('footerLastUpdate');
        
        if (lastUpdateEl) lastUpdateEl.innerHTML = displayText;
        if (headerLastUpdateEl) headerLastUpdateEl.textContent = date;
        if (headerLastUpdateTimeEl) headerLastUpdateTimeEl.textContent = time;
        if (footerLastUpdateEl) footerLastUpdateEl.textContent = date;
    } else {
        const lastUpdateEl = document.getElementById('lastUpdate');
        const headerLastUpdateEl = document.getElementById('headerLastUpdate');
        const headerLastUpdateTimeEl = document.getElementById('headerLastUpdateTime');
        const footerLastUpdateEl = document.getElementById('footerLastUpdate');
        
        if (lastUpdateEl) lastUpdateEl.textContent = '-';
        if (headerLastUpdateEl) headerLastUpdateEl.textContent = '-';
        if (headerLastUpdateTimeEl) headerLastUpdateTimeEl.textContent = '-';
        if (footerLastUpdateEl) footerLastUpdateEl.textContent = '-';
        if (headerLastUpdateEl) headerLastUpdateEl.textContent = '-';
        if (footerLastUpdateEl) footerLastUpdateEl.textContent = '-';
    }
}

// ============================================
// POPULATE FILTER DROPDOWNS
// ============================================

function populateFilterDropdowns(sectors) {
    const sectorSelect = document.getElementById('sectorFilter');
    
    if (!sectorSelect) {
        console.error('sectorFilter element not found in DOM');
        return;
    }
    
    sectors.forEach(sector => {
        const option = document.createElement('option');
        option.value = sector;
        option.textContent = sector;
        sectorSelect.appendChild(option);
    });
}

// ============================================
// VIEW MODE TOGGLE & GROUPING
// ============================================

function toggleViewMode() {
    viewMode = viewMode === 'compressed' ? 'full' : 'compressed';
    localStorage.setItem('viewMode', viewMode);
    updateViewModeUI();
    renderSignalsTable();
    
    // Re-attach sort listeners after table re-render
    setTimeout(() => {
        if (window.attachSortListeners) {
            window.attachSortListeners();
        }
    }, 100);
}

function updateViewModeUI() {
    const slider = document.getElementById('toggleSlider');
    const compactIcon = document.getElementById('compactIcon');
    const detailIcon = document.getElementById('detailIcon');
    const fullHeader = document.getElementById('tableHeader');
    const compressedHeader = document.getElementById('compressedHeader');
    
    if (!slider || !fullHeader || !compressedHeader) {
        console.warn('View mode UI elements not found, skipping update');
        return;
    }
    
    if (viewMode === 'compressed') {
        slider.classList.remove('active');
        if (compactIcon) {
            compactIcon.classList.add('active');
        }
        if (detailIcon) {
            detailIcon.classList.remove('active');
        }
        fullHeader.style.display = 'none';
        compressedHeader.style.display = '';
    } else {
        slider.classList.add('active');
        if (compactIcon) {
            compactIcon.classList.remove('active');
        }
        if (detailIcon) {
            detailIcon.classList.add('active');
        }
        fullHeader.style.display = '';
        compressedHeader.style.display = 'none';
    }
}

function groupSignalsByTicker(signals) {
    const grouped = {};
    
    signals.forEach(signal => {
        const ticker = signal.Ticker;
        if (!grouped[ticker]) {
            grouped[ticker] = {
                ticker: ticker,
                latest: null,
                history: [],
                count: 0
            };
        }
        
        // First signal is latest (signals should already be sorted newest first)
        if (!grouped[ticker].latest) {
            grouped[ticker].latest = signal;
        } else {
            grouped[ticker].history.push(signal);
        }
        grouped[ticker].count++;
    });
    
    // Sort history arrays by date (newest first) for each ticker
    Object.values(grouped).forEach(group => {
        group.history.sort((a, b) => new Date(b.Date) - new Date(a.Date));
    });
    
    return grouped;
}

// ============================================
// RENDER SIGNALS TABLE
// ============================================

function renderSignalsTable() {
    console.log('renderSignalsTable called, allSignals.length:', allSignals.length);
    const tbody = document.getElementById('signalsTableBody');
    
    if (!tbody) {
        console.error('signalsTableBody element not found!');
        return;
    }
    
    // Apply filters
    let filteredSignals = filterSignals();
    console.log('After filtering:', filteredSignals.length, 'signals');
    
    // Apply sorting FIRST (before grouping)
    filteredSignals = sortSignals(filteredSignals);
    console.log('After sorting:', filteredSignals.length, 'signals, sort:', currentSort);
    
    if (filteredSignals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-results">No signals found matching your filters</td></tr>';
        return;
    }
    
    // Delegate to mode-specific renderer
    if (viewMode === 'compressed') {
        renderCompressedMode(filteredSignals, tbody);
    } else {
        renderFullMode(filteredSignals, tbody);
    }
    
    // Initialize sticky header after table is rendered
    setTimeout(() => {
        if (typeof initStickyTableHeader === 'function') {
            initStickyTableHeader();
        }
    }, 100);
}

function renderCompressedMode(signals, tbody) {
    try {
        // Group signals by ticker
        groupedSignals = groupSignalsByTicker(signals);
        
        // Sort tickers based on currentSort settings
        const { column, direction } = currentSort;
        const tickers = Object.keys(groupedSignals).sort((a, b) => {
            const groupA = groupedSignals[a];
            const groupB = groupedSignals[b];
            let aVal, bVal;
            
            switch (column) {
                case 'ticker':
                    // Sort by ticker name alphabetically
                    aVal = a;
                    bVal = b;
                    break;
                case 'date':
                    // Sort by latest signal date (default)
                    aVal = new Date(groupA.latest.Date);
                    bVal = new Date(groupB.latest.Date);
                    break;
                case 'ai_score':
                    // Sort by best AI score across all signals
                    aVal = Math.max(...[groupA.latest, ...groupA.history].map(s => parseFloat(s.AI_Technical_Score) || 0));
                    bVal = Math.max(...[groupB.latest, ...groupB.history].map(s => parseFloat(s.AI_Technical_Score) || 0));
                    break;
                case 'current_pnl':
                    // Sort by latest signal P&L
                    const aTrigger = parseFloat(groupA.latest.Price);
                    const bTrigger = parseFloat(groupB.latest.Price);
                    const aCurrent = allMetadata[a]?.current_price || aTrigger;
                    const bCurrent = allMetadata[b]?.current_price || bTrigger;
                    aVal = ((aCurrent - aTrigger) / aTrigger) * 100;
                    bVal = ((bCurrent - bTrigger) / bTrigger) * 100;
                    break;
                default:
                    // Fallback to date
                    aVal = new Date(groupA.latest.Date);
                    bVal = new Date(groupB.latest.Date);
            }
            
            // Compare values
            if (typeof aVal === 'string') {
                const comparison = aVal.localeCompare(bVal);
                return direction === 'asc' ? comparison : -comparison;
            } else {
                if (aVal < bVal) return direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return direction === 'asc' ? 1 : -1;
                return 0;
            }
        });
        
        console.log('Compressed mode: rendering', tickers.length, 'tickers, sorted by', column, direction);
        
        if (tickers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-results">No grouped signals found</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        
        tickers.forEach(ticker => {
            try {
                const group = groupedSignals[ticker];
                if (!group || !group.latest) {
                    console.warn('Invalid group for ticker:', ticker);
                    return;
                }
                const latest = group.latest;
                const metadata = allMetadata[ticker] || {};
                const tickerInfo = tickerLookup[ticker] || {};
        
        // Calculate latest P&L
        const triggerPrice = parseFloat(latest.Price);
        const currentPrice = metadata.current_price || triggerPrice;
        const currentPnl = ((currentPrice - triggerPrice) / triggerPrice) * 100;
        
        // Color priority: PURPLE > RED > ORANGE > GREEN > YELLOW
        const colorPriority = { 'PURPLE': 5, 'RED': 4, 'ORANGE': 3, 'GREEN': 2, 'YELLOW': 1 };
        const topColor = [latest, ...group.history]
            .sort((a, b) => (colorPriority[b.Signal_Color] || 0) - (colorPriority[a.Signal_Color] || 0))[0].Signal_Color;
        
        // Latest signal's AI score (not max)
        const latestScore = parseFloat(latest.AI_Technical_Score);
        
        // Best rally from metadata
        const bestRally = metadata.best_rally_pct || 0;
        
        // Parent row
        const parentRow = document.createElement('tr');
        parentRow.className = 'ticker-parent-row';
        parentRow.dataset.ticker = ticker;
        parentRow.style.cursor = 'pointer';
        parentRow.onclick = () => showSignalTimeline(ticker);
        
        // Create signal badges (up to 4, then +N more) from ALL signals (latest + history)
        const allTickerSignals = [latest, ...group.history];
        const signalBadges = allTickerSignals.slice(0, 4).map(sig => {
            const parsed = parseSignalType(sig.Signal_Type);
            const baseEmoji = {
                'RED': '🔴',
                'ORANGE': '🟠',
                'GREEN': '🟢',
                'YELLOW': '🟡'
            }[parsed.baseColor] || '🟡';
            
            const enhancedRing = parsed.isEnhanced ? '<span class="enhanced-ring">🟣</span>' : '';
            return `<span class="signal-badge-compact signal-${parsed.baseColor}${parsed.isEnhanced ? ' enhanced' : ''}" title="${sig.Signal_Type}">${enhancedRing}${baseEmoji}</span>`;
        }).join(' ');
        
        // Get market cap
        const marketCapDisplay = tickerInfo.market_cap ? formatMarketCap(tickerInfo.market_cap) : 'N/A';
        
        // Get exchange/market from latest signal data (the source of truth from CSV)
        const exchange = latest.Exchange || 'LSE';
        const market = latest.Market || 'AIM';
        const riskTier = (metadata?.company_info?.risk_tier || metadata?.basics?.risk_tier || 'High Risk');
        
        // Create clean market badge with full names
        // Prioritise exchange being AQUIS so its badges get the 'aquis' class (green)
        const marketBadgeClass = exchange === 'AQUIS' ? 'aquis' : (market === 'MAIN' ? 'lse-main' : 'lse-aim');
        // Show concise text: 'AQUIS' or 'LSE' for MAIN, keep 'LSE AIM' for AIM
        const marketBadgeText = exchange === 'AQUIS' ? 'AQUIS' : (market === 'MAIN' ? 'LSE' : 'LSE AIM');
        const marketBadge = `<span class="market-badge ${marketBadgeClass}">${marketBadgeText}</span>`;
        
        // Check for split warnings - check if latest signal is affected by split
        const splitRisk = metadata.split_risk || {};
        const hasSplit = splitRisk.split_detected || false;
        const latestSignalDate = new Date(latest.Date);
        const splitDate = hasSplit && splitRisk.split_date ? new Date(splitRisk.split_date) : null;
        const isAffectedBySplit = hasSplit && splitDate && latestSignalDate >= splitDate;
        const splitWarningClass = isAffectedBySplit ? 'split-warning' : '';
        
        // Debug for split detection
        if (hasSplit) {
            console.log(`Split detected for ${ticker}:`, {
                latestSignalDate: latest.Date,
                splitDate: splitRisk.split_date,
                isAffectedBySplit,
                splitWarningClass
            });
        }
        
        parentRow.innerHTML = `
            <td class="ticker-cell">
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <div style="font-weight: 700; font-size: 0.95rem;">${cleanTickerDisplay(ticker)}</div>
                    <button class="info-button ${splitWarningClass}" onclick="event.stopPropagation(); showCompanyModal('${ticker}')" title="${isAffectedBySplit ? 'Company Profile ⚠️ Split Risk' : 'Company Profile'}">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                        </svg>
                    </button>
                </div>
                <div class="company-name" style="margin: 2px 0;">${tickerInfo.name || ''}</div>
                <div class="ticker-meta" style="font-size: 0.65rem; color: var(--gray); line-height: 1.3; margin-top: 3px;">
                    <div style="font-weight: 600; color: var(--dark-gray);">Cap: ${marketCapDisplay}</div>
                    <div style="margin-top: 2px;">${marketBadge}</div>
                </div>
            </td>
            <td style="white-space: nowrap;">
                <div style="margin-bottom: 4px;">${signalBadges}</div>
                <div style="font-size: 0.75rem; color: var(--dark-gray); font-weight: 600;">
                    ${latest.Date}
                </div>
            </td>
            <td>
                <div style="display: flex; gap: 0.4rem; align-items: baseline; margin-bottom: 2px;">
                    <div>
                        <span style="font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.3px; color: var(--gray); font-weight: 600; display: block;">Entry</span>
                        <span style="font-size: 0.95rem; color: var(--dark-gray); font-weight: 700;">${triggerPrice.toFixed(2)}p</span>
                    </div>
                    <span style="color: var(--electric-blue); font-size: 0.75rem;">→</span>
                    <div>
                        <span style="font-size: 0.5rem; text-transform: uppercase; letter-spacing: 0.3px; color: var(--gray); font-weight: 500; opacity: 0.8; display: block;">Last</span>
                        <span style="font-size: 0.65rem; color: rgba(44, 62, 80, 0.7); font-weight: 600;">${metadata?.company_info?.current_close_price?.toFixed(2) || currentPrice.toFixed(2)}p</span>
                    </div>
                </div>
                <div class="${currentPnl >= 0 ? 'positive' : 'negative'}" style="font-weight: 700; font-size: 0.8rem; line-height: 1.4; display: flex; align-items: baseline;">
                    <span style="font-size: 0.65rem; color: var(--gray); font-weight: 500; opacity: 0.7; min-width: 32px;">P&L</span>
                    <span>${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%</span>
                </div>
                <div style="font-size: 0.7rem; margin-top: 2px; display: flex; align-items: baseline;">
                    <span style="color: var(--gray); opacity: 0.6; font-size: 0.65rem; min-width: 32px;">Best</span>
                    <span style="color: #0D8C4D; font-weight: 600;">${bestRally.toFixed(0)}%</span>
                </div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-start;">
                    <div style="
                        position: relative;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 32px;
                        height: 32px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
                        cursor: pointer;
                        transition: all 0.2s ease;
                    "
                    onclick="event.stopPropagation(); loadAIReport('${ticker}')"
                    title="AI Analysis Report - Score: ${latestScore.toFixed(1)}"
                    onmouseover="this.style.transform='translateY(-3px) scale(1.1)'; this.style.boxShadow='0 8px 24px rgba(102, 126, 234, 0.8), 0 0 20px rgba(118, 75, 162, 0.6)'; this.style.filter='brightness(1.15)'"
                    onmouseout="this.style.transform='translateY(0) scale(1)'; this.style.boxShadow='0 2px 8px rgba(102, 126, 234, 0.3)'; this.style.filter='brightness(1)'"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="position: relative; z-index: 1;">
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                            <circle cx="9" cy="9" r="2" fill="#fbbf24"/>
                            <circle cx="15" cy="15" r="2" fill="#10b981"/>
                        </svg>
                        <!-- Score badge in top-right corner -->
                        <div style="
                            position: absolute;
                            top: -4px;
                            right: -4px;
                            background: white;
                            color: #667eea;
                            font-size: 0.65rem;
                            font-weight: 800;
                            padding: 1px 4px;
                            border-radius: 4px;
                            line-height: 1;
                            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
                            z-index: 2;
                        ">${latestScore.toFixed(1)}</div>
                        <div style="
                            position: absolute;
                            inset: -2px;
                            border-radius: 8px;
                            background: linear-gradient(135deg, rgba(102, 126, 234, 0.4), rgba(118, 75, 162, 0.4));
                            animation: pulse 2s ease-in-out infinite;
                            z-index: 0;
                        "></div>
                    </div>
                </div>
            </td>
        `;
        
        tbody.appendChild(parentRow);
            } catch (error) {
                console.error('Error rendering ticker:', ticker, error);
            }
        });
    } catch (error) {
        console.error('Error in compressed mode rendering:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="no-results">Error loading signals</td></tr>';
    }
}

// ============================================
// DEPRECATED: Expansion/History Row Functions Removed
// All signal details now shown in Rally Timeline modal
// ============================================

function renderFullMode(signals, tbody) {
    // Limit to latest 100 signals for performance
    const displaySignals = signals.slice(0, 100);
    console.log('Full mode: displaying', displaySignals.length, 'signals');
    
    tbody.innerHTML = '';
    
    displaySignals.forEach((signal, index) => {
        const metadata = allMetadata[signal.Ticker] || {};
        const tickerInfo = tickerLookup[signal.Ticker] || {};
        
        // Main row
        const tr = document.createElement('tr');
        tr.dataset.ticker = signal.Ticker;
        tr.dataset.index = index;
        tr.onclick = () => toggleExpandableRow(index);
        
        // Calculate current P&L from signal (not metadata)
        const triggerPrice = parseFloat(signal.Price);
        const currentPrice = metadata.current_price || triggerPrice;
        const currentPnl = ((currentPrice - triggerPrice) / triggerPrice) * 100;
        const bestRally = metadata.best_rally_pct || 0;
        
        // Check for split warnings - ONLY show for signals affected by the split
        const splitRisk = metadata.split_risk || {};
        const hasSplit = splitRisk.split_detected || false;
        const signalDateObj = new Date(signal.Date);
        const splitDate = hasSplit && splitRisk.split_date ? new Date(splitRisk.split_date) : null;
        
        // Only show warning if signal is AFTER split (within risk window)
        const isAffectedBySplit = hasSplit && splitDate && signalDateObj >= splitDate;
        const splitTooltip = isAffectedBySplit ? `Split ${splitRisk.days_from_split}d ago - Click for details` : '';
        const splitWarningIcon = isAffectedBySplit ? `<span class="split-warning-icon" data-tooltip="${splitTooltip}">⚠️</span>` : '';
        
        // Parse signal type to extract base severity and enhanced status
        const parsed = parseSignalType(signal.Signal_Type);
        
        let shortSignalType = parsed.baseSeverity
            .replace('CRASH ZONE', 'Crash Zone')
            .replace('EXTREME', 'Extreme Crash')
            .replace('ULTRA', 'Ultra Crash')
            .replace('DEEP', 'Deep Crash');
        
        if (signal.Signal_Type.toUpperCase().includes('COMBO')) {
            shortSignalType += ' Combo';
        } else if (signal.Signal_Type.toUpperCase().includes('BOTTOM')) {
            shortSignalType += ' Bottom';
        }
        
        const enhancedBadge = parsed.isEnhanced ? '<span class="enhanced-pill">⚡ ENHANCED</span>' : '';
        const drawdown = parseFloat(signal.Drawdown_Pct).toFixed(0);
        
        // Get market cap
        const marketCapDisplay = tickerInfo.market_cap ? formatMarketCap(tickerInfo.market_cap) : 'N/A';
        
        // Get exchange/market from signal data (the source of truth from CSV)
        const exchange = signal.Exchange || 'LSE';
        const market = signal.Market || 'AIM';
        const riskTier = (metadata?.company_info?.risk_tier || metadata?.basics?.risk_tier || 'High Risk');
        
        // Create clean market badge
        // Prioritise AQUIS exchange so it receives the 'aquis' class (green)
        const marketBadgeClass = exchange === 'AQUIS' ? 'aquis' : (market === 'MAIN' ? 'lse-main' : 'lse-aim');
        // Use concise badge text: 'AQUIS' or 'LSE' for MAIN, keep 'LSE AIM' for AIM
        const marketBadgeText = exchange === 'AQUIS' ? 'AQUIS' : (market === 'MAIN' ? 'LSE' : 'LSE AIM');
        const marketBadge = `<span class="market-badge ${marketBadgeClass}">${marketBadgeText}</span>`;
        
        tr.innerHTML = `
            <td class="ticker-cell">
                <div style="font-weight: 700; font-size: 0.95rem;">${cleanTickerDisplay(signal.Ticker)} ${splitWarningIcon}</div>
                <div class="company-name" style="margin: 2px 0;">${tickerInfo.name || ''}</div>
                <div class="ticker-meta" style="font-size: 0.65rem; color: var(--gray); line-height: 1.3; margin-top: 3px;">
                    <div>${marketBadge}</div>
                    <div style="font-weight: 600; color: var(--dark-gray);">Cap: ${marketCapDisplay}</div>
                </div>
            </td>
            <td>${signal.Date}</td>
            <td>
                <span class="signal-badge signal-${parsed.baseColor}">
                    ${shortSignalType} (${drawdown}%)
                </span>
                ${enhancedBadge}
            </td>
            <td class="price-pnl-cell">
                <div class="price-pnl-container">
                    <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem;">
                        <div style="display: flex; flex-direction: column; align-items: flex-start;">
                            <span style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--gray); font-weight: 600;">Entry</span>
                            <span class="trigger-price" style="font-size: 1rem; font-weight: 800; color: var(--dark-gray);">${parseFloat(signal.Price).toFixed(2)}p</span>
                        </div>
                        <span style="color: var(--electric-blue); font-size: 0.9rem; margin: 0 0.1rem;">→</span>
                        <div style="display: flex; flex-direction: column; align-items: flex-start;">
                            <span style="font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--gray); font-weight: 500; opacity: 0.8;">Last</span>
                            <span class="trigger-price" style="font-size: 0.7rem; font-weight: 600; color: rgba(44, 62, 80, 0.7);">${metadata?.company_info?.current_close_price?.toFixed(2) || currentPrice.toFixed(2)}p</span>
                        </div>
                    </div>
                    <span class="pnl-badge ${currentPnl >= 0 ? 'positive' : 'negative'}">
                        ${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%
                    </span>
                </div>
            </td>
            <td class="positive">+${bestRally.toFixed(1)}%</td>
            <td>
                <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-start;">
                    <div style="
                        position: relative;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 32px;
                        height: 32px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
                        cursor: pointer;
                        transition: all 0.2s ease;
                    "
                    onclick="event.stopPropagation(); loadAIReport('${signal.Ticker}')"
                    title="AI Analysis Report - Score: ${latestScore.toFixed(1)}"
                    onmouseover="this.style.transform='translateY(-3px) scale(1.1)'; this.style.boxShadow='0 8px 24px rgba(102, 126, 234, 0.8), 0 0 20px rgba(118, 75, 162, 0.6)'; this.style.filter='brightness(1.15)'"
                    onmouseout="this.style.transform='translateY(0) scale(1)'; this.style.boxShadow='0 2px 8px rgba(102, 126, 234, 0.3)'; this.style.filter='brightness(1)'"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="position: relative; z-index: 1;">
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                            <circle cx="9" cy="9" r="2" fill="#fbbf24"/>
                            <circle cx="15" cy="15" r="2" fill="#10b981"/>
                        </svg>
                        <!-- Score badge in top-right corner -->
                        <div style="
                            position: absolute;
                            top: -4px;
                            right: -4px;
                            background: white;
                            color: #667eea;
                            font-size: 0.65rem;
                            font-weight: 800;
                            padding: 1px 4px;
                            border-radius: 4px;
                            line-height: 1;
                            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
                            z-index: 2;
                        ">${parseFloat(signal.AI_Technical_Score).toFixed(1)}</div>
                        <div style="
                            position: absolute;
                            inset: -2px;
                            border-radius: 8px;
                            background: linear-gradient(135deg, rgba(102, 126, 234, 0.4), rgba(118, 75, 162, 0.4));
                            animation: pulse 2s ease-in-out infinite;
                            z-index: 0;
                        "></div>
                    </div>
                </div>
            </td>
        `;
        
        tbody.appendChild(tr);
        
        // Expandable row (hidden by default)
        const expandRow = createExpandableRow(signal, metadata, tickerInfo);
        tbody.appendChild(expandRow);
    });
}

// ============================================
// CREATE EXPANDABLE ROW (METADATA DETAILS)
// ============================================

function createExpandableRow(signal, metadata, tickerInfo) {
    const tr = document.createElement('tr');
    tr.className = 'expandable-row';
    tr.dataset.expandIndex = signal.Ticker;
    
    const companyInfo = metadata.company_info || {};
    const basics = metadata.basics || {};
    const latestSignal = metadata.latest_signal || {};
    const bestSignal = metadata.best_historical_signal || {};
    const stats = metadata.stats || {};
    const splits = metadata.splits || [];
    const riskFlags = metadata.risk_flags || [];
    
    // LSE ticker info
    const lseTicker = basics.lse_ticker || metadata.lse_ticker || signal.Ticker.replace('.L', '');
    const exchange = basics.exchange || metadata.exchange || 'LSE';
    const market = basics.market || metadata.market || 'AIM';

    // Use pence-aware helpers to get prices and market cap in GBP floats
    const currentPriceVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, basics, 'current_price');
    const athVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, basics, 'week_52_high');
    const atlVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, basics, 'week_52_low');
    const latestEntryVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, latestSignal, 'price');
    const bestEntryVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, bestSignal, 'entry_price');
    const bestPeakVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, bestSignal, 'peak_price');

    const marketCapCandidate = getMarketCapCandidate(signal?.Ticker || lseTicker, metadata, tickerInfo);
    const formattedMarketCap = formatMarketCap(marketCapCandidate);

    const fmtPrice = (v) => (v !== undefined && v !== null && !isNaN(v)) ? Number(v).toFixed(4) : '-';
    
    tr.innerHTML = `
        <td colspan="8">
            <div class="expandable-content">
                <div class="metadata-grid">
                    
                    <!-- Company Info -->
                    <div class="metadata-section">
                        <h4>🏢 Company Information</h4>
                        <div class="metadata-item">
                            <span class="metadata-label">Name:</span>
                            <span class="metadata-value">${companyInfo.name || 'Unknown'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">LSE Ticker:</span>
                            <span class="metadata-value"><strong>${lseTicker}</strong></span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Exchange:</span>
                            <span class="metadata-value">${exchange} (${market})</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Currency:</span>
                            <span class="metadata-value">${companyInfo.currency || 'GBP'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Sector:</span>
                            <span class="metadata-value">${companyInfo.sector || 'Unknown'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Industry:</span>
                            <span class="metadata-value">${companyInfo.industry || 'Unknown'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Market Cap:</span>
                            <span class="metadata-value">${formattedMarketCap}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Current Price:</span>
                            <span class="metadata-value">${fmtPrice(currentPriceVal)}p</span>
                        </div>
                    </div>
                    
                    <!-- Price Action -->
                    <div class="metadata-section">
                        <h4>📊 Price Action</h4>
                        <div class="metadata-item">
                            <span class="metadata-label">52 Week High</span>
                            <span class="metadata-value">${fmtPrice(athVal)}p</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">52 Week High Date</span>
                            <span class="metadata-value">${basics.week_52_high_date ? new Date(basics.week_52_high_date).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).replace(/ /g, '-') : '-'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">52 Week Low</span>
                            <span class="metadata-value">${fmtPrice(atlVal)}p</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">52 Week Low Date</span>
                            <span class="metadata-value">${basics.week_52_low_date ? new Date(basics.week_52_low_date).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).replace(/ /g, '-') : '-'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Current Drawdown:</span>
                            <span class="metadata-value negative">${basics.drawdown_from_ath_pct?.toFixed(1) || '-'}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Data Coverage:</span>
                            <span class="metadata-value">${basics.data_start || '-'} to ${basics.data_end || '-'}</span>
                        </div>
                    </div>
                    
                    <!-- Latest Signal -->
                    <div class="metadata-section">
                        <h4>🎯 Latest Signal</h4>
                        <div class="metadata-item">
                            <span class="metadata-label">Signal Date:</span>
                            <span class="metadata-value">${latestSignal.date || '-'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Trigger Price:</span>
                            <span class="metadata-value">${fmtPrice(latestEntryVal)}p</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">RSI:</span>
                            <span class="metadata-value">${latestSignal.rsi?.toFixed(1) || '-'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Cycle Position:</span>
                            <span class="metadata-value">${((latestSignal.cycle_position || 0) * 100).toFixed(0)}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Holding Period:</span>
                            <span class="metadata-value">${latestSignal.holding_period_days || 0} days</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Current P&L:</span>
                            <span class="metadata-value ${latestSignal.current_pnl_pct >= 0 ? 'positive' : 'negative'}">
                                ${latestSignal.current_pnl_pct >= 0 ? '+' : ''}${latestSignal.current_pnl_pct?.toFixed(1) || 0}%
                            </span>
                        </div>
                    </div>
                    
                    <!-- Best Historical Signal -->
                    <div class="metadata-section">
                        <h4>🏆 Best Historical Signal</h4>
                        <div class="metadata-item">
                            <span class="metadata-label">Signal Date:</span>
                            <span class="metadata-value">${bestSignal.signal_date || '-'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Trigger Price:</span>
                            <span class="metadata-value">${fmtPrice(bestEntryVal)}p</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Peak Price:</span>
                            <span class="metadata-value">${fmtPrice(bestPeakVal)}p</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Rally:</span>
                            <span class="metadata-value positive">+${bestSignal.rally_pct?.toFixed(1) || 0}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Days to Peak:</span>
                            <span class="metadata-value">${bestSignal.days_to_peak || '-'} days</span>
                        </div>
                    </div>
                    
                    <!-- Performance Stats -->
                    <div class="metadata-section">
                        <h4>📈 Performance Statistics</h4>
                        <div class="metadata-item">
                            <span class="metadata-label">Total Signals:</span>
                            <span class="metadata-value">${stats.total_signals || 0}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Win Rate:</span>
                            <span class="metadata-value positive">${stats.win_rate_pct?.toFixed(0) || 0}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Avg Rally:</span>
                            <span class="metadata-value positive">+${stats.avg_rally_pct?.toFixed(1) || 0}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Median Rally:</span>
                            <span class="metadata-value positive">+${stats.median_rally_pct?.toFixed(1) || 0}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Best Rally:</span>
                            <span class="metadata-value positive">+${stats.best_rally_pct?.toFixed(1) || 0}%</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Worst Rally:</span>
                            <span class="metadata-value positive">+${stats.worst_rally_pct?.toFixed(1) || 0}%</span>
                        </div>
                    </div>
                    
                    <!-- Risk Flags & Splits -->
                    <div class="metadata-section">
                        <h4>⚠️ Risk Factors</h4>
                        ${riskFlags.length > 0 ? `
                            <div class="risk-flags">
                                ${riskFlags.map(flag => `<span class="risk-flag">${flag}</span>`).join('')}
                            </div>
                        ` : '<p style="color: var(--recovery-green); font-weight: 600;">✓ No major risk flags detected</p>'}
                        
                        ${splits.length > 0 ? `
                            <h4 style="margin-top: 1rem;">🔀 Stock Splits</h4>
                            ${splits.map(split => `
                                <div class="metadata-item">
                                    <span class="metadata-label">${split.date}:</span>
                                    <span class="metadata-value">${split.ratio} (${split.ratio_value}x)</span>
                                </div>
                            `).join('')}
                        ` : ''}
                    </div>
                    
                    <!-- Split Risk Assessment (if detected) - MOVED TO BOTTOM -->
                    ${metadata.split_risk?.split_detected ? `
                    <div class="metadata-section split-risk-section">
                        <h4>⚠️ Split Risk</h4>
                        <div class="split-risk-summary">
                            <span class="metadata-label">Split:</span>
                            <span class="metadata-value">${metadata.split_risk.split_date} (${metadata.split_risk.days_from_split}d away)</span>
                            <span class="metadata-value risk-badge-${metadata.split_risk.risk_level.toLowerCase()}">${metadata.split_risk.risk_level}</span>
                        </div>
                        
                        <!-- Collapsible Warning -->
                        <div class="split-collapsible">
                            <div class="split-collapsible-header" onclick="this.parentElement.classList.toggle('expanded')">
                                <span>⚠️ Details</span>
                                <span class="expand-icon">▼</span>
                            </div>
                            <div class="split-collapsible-content">
                                <strong>Warning:</strong> ${metadata.split_risk.warning}<br><br>
                                <strong>Recommendation:</strong> ${metadata.split_risk.recommendation}
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
                </div>
            </div>
        </td>
    `;
    
    return tr;
}

// ============================================
// TOGGLE EXPANDABLE ROW
// ============================================

async function toggleExpandableRow(index) {
    const expandableRows = document.querySelectorAll('.expandable-row');
    const targetRow = Array.from(expandableRows).find(row => {
        const prevRow = row.previousElementSibling;
        return prevRow && prevRow.dataset.index == index;
    });
    
    if (targetRow) {
        // Get the ticker for this row
        const ticker = targetRow.dataset.expandIndex;
        
        // If opening (not already active), load full details first
        if (!targetRow.classList.contains('active')) {
            // Show loading state
            const contentDiv = targetRow.querySelector('.expandable-content');
            const originalContent = contentDiv.innerHTML;
            contentDiv.innerHTML = '<div style="padding: 20px; text-align: center;">⏳ Loading ticker details...</div>';
            
            // Load full details
            const fullMetadata = await loadTickerDetails(ticker);
            
            // Re-render the expandable content with full details
            const signal = allSignals.find(s => s.Ticker === ticker);
            const tickerInfo = tickerLookup[ticker] || {};
            
            if (signal && fullMetadata) {
                // Rebuild the expanded content
                const newExpandRow = createExpandableRow(signal, fullMetadata, tickerInfo);
                targetRow.innerHTML = newExpandRow.innerHTML;
            } else {
                // Restore original content if loading failed
                contentDiv.innerHTML = originalContent;
            }
        }
        
        // Close all other rows
        expandableRows.forEach(row => {
            if (row !== targetRow) {
                row.classList.remove('active');
            }
        });
        
        // Toggle this row
        targetRow.classList.toggle('active');
    }
}

// ============================================
// FILTERING
// ============================================

function filterSignals() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const colorFilter = document.getElementById('colorFilter').value;
    const sectorFilter = document.getElementById('sectorFilter').value;
    const marketFilter = document.getElementById('marketFilter').value;
    const marketCapFilter = document.getElementById('marketCapFilter').value;
    
    return allSignals.filter(signal => {
        // Search filter
        const tickerInfo = tickerLookup[signal.Ticker] || {};
        const searchMatch = !searchTerm || 
            signal.Ticker.toLowerCase().includes(searchTerm) ||
            (tickerInfo.name || '').toLowerCase().includes(searchTerm);
        
        // Color filter
        const colorMatch = !colorFilter || signal.Signal_Color === colorFilter;
        
        // Sector filter
        const sectorMatch = !sectorFilter || tickerInfo.sector === sectorFilter;
        
        // Market filter
        let marketMatch = true;
        if (marketFilter) {
            const exchange = signal.Exchange || '';
            const market = signal.Market || '';
            const marketKey = `${exchange}-${market}`;
            marketMatch = marketKey === marketFilter;
        }
        
        // Market Cap filter
        let marketCapMatch = true;
        if (marketCapFilter) {
            const metadata = allMetadata[signal.Ticker];
            const marketCap = getMarketCapCandidate(signal.Ticker, metadata, tickerInfo);
            
            if (marketCap !== undefined) {
                const capMillions = marketCap / 1_000_000;
                
                if (marketCapFilter === '0-1') {
                    marketCapMatch = capMillions < 1;
                } else if (marketCapFilter === '1-5') {
                    marketCapMatch = capMillions >= 1 && capMillions < 5;
                } else if (marketCapFilter === '5-20') {
                    marketCapMatch = capMillions >= 5 && capMillions < 20;
                } else if (marketCapFilter === '20-50') {
                    marketCapMatch = capMillions >= 20 && capMillions < 50;
                } else if (marketCapFilter === '50-100') {
                    marketCapMatch = capMillions >= 50 && capMillions < 100;
                } else if (marketCapFilter === '100-250') {
                    marketCapMatch = capMillions >= 100 && capMillions < 250;
                } else if (marketCapFilter === '250+') {
                    marketCapMatch = capMillions >= 250;
                }
            } else {
                // If no market cap data, exclude from filtered results
                marketCapMatch = false;
            }
        }
        
        // Date filter
        let dateMatch = true;
        if (dateFilter !== 'all') {
            const signalDate = new Date(signal.Date);
            const today = new Date();
            
            if (dateFilter === 'custom') {
                if (customDateRange.start) {
                    dateMatch = dateMatch && signalDate >= new Date(customDateRange.start);
                }
                if (customDateRange.end) {
                    dateMatch = dateMatch && signalDate <= new Date(customDateRange.end);
                }
            } else {
                // Calculate cutoff date based on filter
                let cutoffDate = new Date(today);
                switch(dateFilter) {
                    case '1m':
                        cutoffDate.setMonth(cutoffDate.getMonth() - 1);
                        break;
                    case '3m':
                        cutoffDate.setMonth(cutoffDate.getMonth() - 3);
                        break;
                    case '6m':
                        cutoffDate.setMonth(cutoffDate.getMonth() - 6);
                        break;
                    case '1y':
                        cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
                        break;
                }
                dateMatch = signalDate >= cutoffDate;
            }
        }
        
        // Exclude signals with missing critical data
        const hasValidData = signal.Ticker && signal.Date && signal.Signal_Color;
        
        return hasValidData && searchMatch && colorMatch && sectorMatch && marketMatch && marketCapMatch && dateMatch;
    });
}

// ============================================
// SORTING
// ============================================

function sortSignals(signals) {
    const { column, direction } = currentSort;
    
    return signals.sort((a, b) => {
        let aVal, bVal;
        
        switch (column) {
            case 'ticker':
                aVal = a.Ticker;
                bVal = b.Ticker;
                break;
            case 'date':
                aVal = new Date(a.Date);
                bVal = new Date(b.Date);
                break;
            case 'signal_type':
                // Sort by color priority first, then signal type
                const colorOrder = { PURPLE: 5, RED: 4, ORANGE: 3, GREEN: 2, YELLOW: 1 };
                aVal = (colorOrder[a.Signal_Color] || 0) * 1000 + (a.Signal_Type || '').localeCompare(b.Signal_Type || '');
                bVal = (colorOrder[b.Signal_Color] || 0) * 1000;
                break;
            case 'ai_score':
                aVal = parseFloat(a.AI_Technical_Score) || 0;
                bVal = parseFloat(b.AI_Technical_Score) || 0;
                break;
            case 'current_pnl':
                // Calculate P&L from trigger price vs current price
                const aTrigger = parseFloat(a.Price);
                const bTrigger = parseFloat(b.Price);
                const aCurrent = allMetadata[a.Ticker]?.current_price || aTrigger;
                const bCurrent = allMetadata[b.Ticker]?.current_price || bTrigger;
                aVal = ((aCurrent - aTrigger) / aTrigger) * 100;
                bVal = ((bCurrent - bTrigger) / bTrigger) * 100;
                break;
            case 'best_rally':
                aVal = allMetadata[a.Ticker]?.best_rally_pct || 0;
                bVal = allMetadata[b.Ticker]?.best_rally_pct || 0;
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    console.log('Setting up event listeners...');
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderSignalsTable();
        });
    } else {
        console.error('searchInput element not found');
    }
    
    // Filter dropdowns
    ['colorFilter', 'sectorFilter', 'marketFilter', 'marketCapFilter'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                renderSignalsTable();
            });
        } else {
            console.error(`${id} element not found`);
        }
    });
    
    // Date range filter dropdown
    const dateRangeFilter = document.getElementById('dateRangeFilter');
    if (dateRangeFilter) {
        dateRangeFilter.addEventListener('change', () => {
            dateFilter = dateRangeFilter.value;
            
            // Show/hide custom date inputs
            const customInputs = document.getElementById('customDateInputs');
            if (customInputs) {
                customInputs.style.display = dateFilter === 'custom' ? 'flex' : 'none';
            }
            
            renderSignalsTable();
        });
    }
    
    // Custom date range inputs
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    if (startDateInput && endDateInput) {
        startDateInput.addEventListener('change', () => {
            customDateRange.start = startDateInput.value;
            if (dateFilter === 'custom') renderSignalsTable();
        });
        endDateInput.addEventListener('change', () => {
            customDateRange.end = endDateInput.value;
            if (dateFilter === 'custom') renderSignalsTable();
        });
    }
    
    // Table sorting - attach to both headers (make global for re-use)
    window.attachSortListeners = function() {
        const sortableHeaders = document.querySelectorAll('.signals-table th.sortable');
        console.log('Attaching sort listeners to', sortableHeaders.length, 'headers');
        sortableHeaders.forEach(th => {
            // Remove old listener if exists
            const newTh = th.cloneNode(true);
            th.parentNode.replaceChild(newTh, th);
            
            newTh.addEventListener('click', () => {
                const sortColumn = newTh.dataset.sort;
                console.log('Sorting by:', sortColumn);
                
                // Map compressed column names to full mode equivalents
                const columnMap = {
                    'latest_date': 'date',
                    'latest_color': 'signal_type',
                    'latest_score': 'ai_score',
                    'latest_pnl': 'current_pnl',
                    'signal_count': 'date'  // Sort by latest signal date (most recent first)
                };
                const mappedColumn = columnMap[sortColumn] || sortColumn;
                
                // Toggle direction if same column
                if (currentSort.column === mappedColumn) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = mappedColumn;
                    currentSort.direction = 'desc';
                }
                
                // Update UI
                document.querySelectorAll('.signals-table th').forEach(header => {
                    header.classList.remove('sort-asc', 'sort-desc');
                });
                newTh.classList.add(`sort-${currentSort.direction}`);
                
                renderSignalsTable();
            });
        });
    };
    
    attachSortListeners();
    
    console.log('Event listeners setup complete');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('colorFilter').value = '';
    document.getElementById('sectorFilter').value = '';
    document.getElementById('marketFilter').value = '';
    document.getElementById('marketCapFilter').value = '';
    
    // Reset date filter to 'all'
    dateFilter = 'all';
    customDateRange = { start: null, end: null };
    const dateRangeFilter = document.getElementById('dateRangeFilter');
    if (dateRangeFilter) dateRangeFilter.value = 'all';
    
    const customInputs = document.getElementById('customDateInputs');
    if (customInputs) customInputs.style.display = 'none';
    
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    
    renderSignalsTable();
}

function formatMarketCap(marketCap) {
    if (!marketCap) return 'N/A';
    if (marketCap >= 1000000000) return `${(marketCap / 1000000000).toFixed(2)}B`;
    if (marketCap >= 1000000) return `${(marketCap / 1000000).toFixed(2)}M`;
    if (marketCap >= 1000) return `${(marketCap / 1000).toFixed(2)}K`;
    return `${marketCap}`;
}

// ============================================
// FILTERS MODAL FUNCTIONS
// ============================================

function openFiltersModal() {
    const modal = document.getElementById('filtersModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeFiltersModal() {
    const modal = document.getElementById('filtersModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function applyFilters() {
    closeFiltersModal();
    renderSignalsTable();
}

function updateFilterCount() {
    let count = 0;
    
    const colorFilter = document.getElementById('colorFilter').value;
    const sectorFilter = document.getElementById('sectorFilter').value;
    const marketFilter = document.getElementById('marketFilter').value;
    const marketCapFilter = document.getElementById('marketCapFilter').value;
    const dateRangeFilter = document.getElementById('dateRangeFilter').value;
    
    if (colorFilter) count++;
    if (sectorFilter) count++;
    if (marketFilter) count++;
    if (marketCapFilter) count++;
    if (dateRangeFilter && dateRangeFilter !== 'all') count++;
    
    const resetIconBtn = document.getElementById('resetIconBtn');
    
    if (count > 0) {
        if (resetIconBtn) resetIconBtn.style.display = 'inline-block';
    } else {
        if (resetIconBtn) resetIconBtn.style.display = 'none';
    }
}

// Initialize modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const openBtn = document.getElementById('openFiltersBtn');
    if (openBtn) {
        openBtn.addEventListener('click', openFiltersModal);
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeFiltersModal();
            closeCompanyModal();
        }
    });
    
    // Initial filter count update
    updateFilterCount();
});

// ============================================
// COMPANY PROFILE MODAL
// ============================================

async function showCompanyModal(ticker) {
    // Show loading modal first
    const loadingHTML = `
        <div class="company-modal-overlay" id="companyModalOverlay" onclick="closeCompanyModal()">
            <div class="company-modal-content" onclick="event.stopPropagation()">
                <div style="padding: 40px; text-align: center; color: var(--white);">
                    <div style="font-size: 2rem; margin-bottom: 1rem;">⏳</div>
                    <div>Loading ${cleanTickerDisplay(ticker)} details...</div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', loadingHTML);
    document.body.style.overflow = 'hidden';
    
    // Load full metadata
    const metadata = await loadTickerDetails(ticker);
    const tickerInfo = tickerLookup[ticker];
    
    if (!metadata) {
        closeCompanyModal();
        console.error('No metadata for', ticker);
        return;
    }
    
    const companyInfo = metadata.company_info || {};
    const basics = metadata.basics || {};
    const latestSignal = metadata.latest_signal || {};
    const bestSignal = metadata.best_historical_signal || {};
    const stats = metadata.stats || {};
    const riskFlags = metadata.risk_flags || [];
    
    // LSE ticker info - basics.ticker, company_info has exchange/market/industry
    const lseTicker = basics.ticker ? basics.ticker.replace('.L', '') : ticker.replace('.L', '');
    const exchange = companyInfo.exchange || 'LSE';
    const market = companyInfo.market || 'AIM';

    // Use pence-aware helpers to get prices and market cap in GBP floats
    const currentPriceVal = getPriceFieldForTicker(ticker, basics, 'current_price');
    const athVal = getPriceFieldForTicker(ticker, basics, 'week_52_high');
    const atlVal = getPriceFieldForTicker(ticker, basics, 'week_52_low');
    const latestEntryVal = getPriceFieldForTicker(ticker, latestSignal, 'price');
    const bestEntryVal = getPriceFieldForTicker(ticker, bestSignal, 'entry_price');
    const bestPeakVal = getPriceFieldForTicker(ticker, bestSignal, 'peak_price');

    const marketCapCandidate = getMarketCapCandidate(ticker, metadata, tickerInfo);
    const formattedMarketCap = formatMarketCap(marketCapCandidate);

    const fmtPrice = (v) => (v !== undefined && v !== null && !isNaN(v)) ? Number(v).toFixed(4) : '-';
    
    // Close loading modal and show full modal
    closeCompanyModal();
    
    const modalHTML = `
        <div class="company-modal-overlay" id="companyModalOverlay" onclick="closeCompanyModal()">
            <div class="company-modal-content" onclick="event.stopPropagation()">
                <div class="company-modal-header">
                    <div>
                        <h2>${cleanTickerDisplay(ticker)}</h2>
                        <p style="color: var(--gray); margin: 0.25rem 0 0 0;">${companyInfo.name || 'Unknown'}</p>
                    </div>
                    <button class="modal-close-btn" onclick="closeCompanyModal()">&times;</button>
                </div>
                <div class="company-modal-body">
                    <div class="metadata-grid">
                        <!-- Split Risk Assessment (if detected) - MOVED TO TOP -->
                        ${metadata.split_risk?.split_detected ? `
                        <div class="metadata-section split-risk-section">
                            <h4>⚠️ Split Risk</h4>
                            <div class="split-risk-summary">
                                <span class="metadata-label">Split:</span>
                                <span class="metadata-value">${metadata.split_risk.split_date} (${metadata.split_risk.days_from_split}d away)</span>
                                <span class="metadata-value risk-badge-${metadata.split_risk.risk_level.toLowerCase()}">${metadata.split_risk.risk_level}</span>
                            </div>
                            
                            <!-- Collapsible Warning -->
                            <div class="split-collapsible">
                                <div class="split-collapsible-header" onclick="this.parentElement.classList.toggle('expanded')">
                                    <span>⚠️ Details</span>
                                    <span class="expand-icon">▼</span>
                                </div>
                                <div class="split-collapsible-content">
                                    <strong>Warning:</strong> ${metadata.split_risk.warning}<br><br>
                                    <strong>Recommendation:</strong> ${metadata.split_risk.recommendation}
                                </div>
                            </div>
                        </div>
                        ` : ''}
                        
                        <!-- Company Info -->
                        <div class="metadata-section">
                            <h4>🏢 Company Information</h4>
                            <div class="metadata-item">
                                <span class="metadata-label">LSE Ticker:</span>
                                <span class="metadata-value"><strong>${lseTicker}</strong></span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Exchange:</span>
                                <span class="metadata-value">${exchange}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Market:</span>
                                <span class="metadata-value">${market}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Currency:</span>
                                <span class="metadata-value">${companyInfo.currency || 'GBP'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Sector:</span>
                                <span class="metadata-value">${companyInfo.sector || 'Unknown'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Industry:</span>
                                <span class="metadata-value">${companyInfo.industry || 'Unknown'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Market Cap:</span>
                                <span class="metadata-value">${formattedMarketCap}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Current Price:</span>
                                <span class="metadata-value">${fmtPrice(currentPriceVal)}p</span>
                            </div>
                        </div>
                        
                        <!-- Price Action -->
                        <div class="metadata-section">
                            <h4>📊 Price Action</h4>
                            <div class="metadata-item">
                                <span class="metadata-label">52 Week High</span>
                                <span class="metadata-value">${fmtPrice(athVal)}p</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">52 Week High Date</span>
                                <span class="metadata-value">${basics.week_52_high_date ? new Date(basics.week_52_high_date).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).replace(/ /g, '-') : '-'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">52 Week Low</span>
                                <span class="metadata-value">${fmtPrice(atlVal)}p</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">52 Week Low Date</span>
                                <span class="metadata-value">${basics.week_52_low_date ? new Date(basics.week_52_low_date).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).replace(/ /g, '-') : '-'}</span>
                            </div>
                        </div>
                        
                        <!-- Latest Signal -->
                        <div class="metadata-section">
                            <h4>🎯 Latest Signal</h4>
                            <div class="metadata-item">
                                <span class="metadata-label">Signal Date:</span>
                                <span class="metadata-value">${latestSignal.date || '-'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Signal Type:</span>
                                <span class="metadata-value">${latestSignal.signal_type || '-'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Entry Price:</span>
                                <span class="metadata-value">${fmtPrice(latestEntryVal)}p</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">AI Score:</span>
                                <span class="metadata-value">
                                    ${latestSignal.ai_score?.toFixed(1) || '-'}
                                    <button 
                                        onclick="loadAIReport('${ticker}')"
                                        style="
                                            margin-left: 8px;
                                            padding: 4px 10px;
                                            background: rgba(10, 132, 255, 0.15);
                                            color: var(--primary);
                                            border: 1px solid var(--primary);
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 0.85rem;
                                            font-weight: 500;
                                            transition: all 0.2s ease;
                                        "
                                        onmouseover="this.style.background='var(--primary)'; this.style.color='white'"
                                        onmouseout="this.style.background='rgba(10, 132, 255, 0.15)'; this.style.color='var(--primary)'"
                                    >
                                        📊 View Report
                                    </button>
                                </span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Cycle Position:</span>
                                <span class="metadata-value">${((latestSignal.cycle_position || 0) * 100).toFixed(0)}%</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Holding Period:</span>
                                <span class="metadata-value">${latestSignal.holding_period_days || 0} days</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Current P&L:</span>
                                <span class="metadata-value ${latestSignal.current_pnl_pct >= 0 ? 'positive' : 'negative'}">
                                    ${latestSignal.current_pnl_pct >= 0 ? '+' : ''}${latestSignal.current_pnl_pct?.toFixed(1) || 0}%
                                </span>
                            </div>
                        </div>
                        
                        <!-- Historical Performance -->
                        <div class="metadata-section">
                            <h4>📈 Historical Performance</h4>
                            <div class="metadata-item">
                                <span class="metadata-label">Total Signals:</span>
                                <span class="metadata-value">${stats.total_signals || 0}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Win Rate:</span>
                                <span class="metadata-value positive">${stats.win_rate_pct?.toFixed(0) || 0}%</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Best Rally:</span>
                                <span class="metadata-value positive">+${stats.best_rally_pct?.toFixed(0) || 0}%</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Avg Rally:</span>
                                <span class="metadata-value">${stats.avg_rally_pct?.toFixed(0) || 0}%</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Best Signal Date:</span>
                                <span class="metadata-value">${bestSignal.signal_date || '-'}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Peak Rally:</span>
                                <span class="metadata-value positive">+${bestSignal.rally_pct?.toFixed(1) || 0}% (${bestSignal.days_to_peak || 0} days)</span>
                            </div>
                        </div>
                        
                        <!-- Risk Flags & Splits -->
                        <div class="metadata-section">
                            <h4>⚠️ Risk Factors</h4>
                            ${riskFlags.length > 0 ? `
                                <div class="risk-flags">
                                    ${riskFlags.map(flag => `<span class="risk-flag">${flag}</span>`).join('')}
                                </div>
                            ` : '<p style="color: var(--recovery-green); font-weight: 600; margin: 0;">✓ No major risk flags detected</p>'}
                            
                            ${metadata.splits && metadata.splits.length > 0 ? `
                                <h4 style="margin-top: 1rem; color: var(--white); font-size: 0.9rem; border-bottom: 1px solid rgba(10, 132, 255, 0.3); padding-bottom: 0.3rem;">🔀 Stock Splits</h4>
                                ${metadata.splits.map(split => `
                                    <div class="metadata-item">
                                        <span class="metadata-label">${split.date}:</span>
                                        <span class="metadata-value">${split.ratio} (${split.ratio_value}x)</span>
                                    </div>
                                `).join('')}
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';
}

function closeCompanyModal() {
    const modal = document.getElementById('companyModalOverlay');
    if (modal) {
        modal.remove();
        document.body.style.overflow = '';
    }
}

// ============================================
// SIGNAL TIMELINE MODAL
// ============================================

async function showSignalTimeline(ticker) {
    console.log(`showSignalTimeline called for ${ticker}`);
    
    try {
        // Reset display count for this ticker
        signalDisplayCount[ticker] = 10;
        
        // Load full metadata if not already loaded
        let metadata = allMetadata[ticker];
        if (!metadata || !metadata.all_historical_signals) {
            console.log(`Loading full metadata for Rally Details: ${ticker}`);
            metadata = await loadTickerDetails(ticker);
        }
        
        if (!metadata || !metadata.all_historical_signals) {
            console.warn(`No signal history found for ${ticker}`);
            alert(`No rally history available for ${ticker}`);
            return;
        }
        
        console.log(`Metadata loaded for ${ticker}, signals:`, metadata.all_historical_signals.length);
        
        const modal = document.getElementById('signalTimelineModal');
        const content = document.getElementById('signalTimelineContent');
        
        if (!modal || !content) {
            console.error('Modal elements not found!');
            return;
        }
        
        const latestSignal = metadata.latest_signal || {};
        const allSignals = metadata.all_historical_signals || [];
        
        // Rally State colors and labels
        const rallyStateColors = {
        'accumulating': { bg: '#6b7280', text: 'Accumulating' },
        'rallying': { bg: '#22c55e', text: 'Rallying' },
        'peaked': { bg: '#ef4444', text: 'Peaked' },
        'pulling_back': { bg: '#3b82f6', text: 'Pulling Back' }
        };
        
        const currentState = latestSignal.rally_state ? rallyStateColors[latestSignal.rally_state] : null;
        
        content.innerHTML = `
        <h2 style="color: white; margin: 0 0 1.5rem 0; font-size: 1.5rem;">
            ${cleanTickerDisplay(ticker)} - Rally Timeline
        </h2>
        
        <!-- 5-Year Price Chart -->
        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; border: 1px solid rgba(10, 132, 255, 0.2);">
            <h3 style="color: white; margin: 0 0 1rem 0; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                📈 ${cleanTickerDisplay(ticker)} - 5 Year Price History
            </h3>
            <div id="priceChart" style="width: 100%; height: 400px; min-height: 300px;"></div>
        </div>
        
        <!-- Current Rally Analysis Card -->
        <div style="background: linear-gradient(135deg, var(--navy), #1A3A52); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; color: white; border: 1px solid rgba(10, 132, 255, 0.3);">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                📊 Current Rally Analysis
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                ${currentState ? `
                    <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 0.75rem;">
                        <div style="color: rgba(255,255,255,0.7); font-size: 0.75rem; margin-bottom: 4px;">Rally State</div>
                        <div style="color: white; font-size: 1.1rem; font-weight: 700;">${currentState.text}</div>
                    </div>
                ` : ''}
                ${latestSignal.Rally_Count !== undefined ? `
                    <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 0.75rem;">
                        <div style="color: rgba(255,255,255,0.7); font-size: 0.75rem; margin-bottom: 4px;">Rally Cycles</div>
                        <div style="color: white; font-size: 1.1rem; font-weight: 700;">${latestSignal.Rally_Count} ${latestSignal.Rally_Count >= 2 ? '⚠️' : ''}</div>
                    </div>
                ` : ''}
                ${latestSignal.lock_in_reached ? `
                    <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 0.75rem;">
                        <div style="color: rgba(255,255,255,0.7); font-size: 0.75rem; margin-bottom: 4px;">Lock-in Status</div>
                        <div style="color: white; font-size: 1.1rem; font-weight: 700;">✓ Achieved</div>
                        ${latestSignal.lock_in_date ? `<div style="color: rgba(255,255,255,0.6); font-size: 0.7rem;">${new Date(latestSignal.lock_in_date).toLocaleDateString('en-GB')}</div>` : ''}
                    </div>
                ` : ''}
                ${latestSignal.distance_from_high_pct !== undefined ? `
                    <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 0.75rem;">
                        <div style="color: rgba(255,255,255,0.7); font-size: 0.75rem; margin-bottom: 4px;">From Peak</div>
                        <div style="color: white; font-size: 1.1rem; font-weight: 700;">${latestSignal.distance_from_high_pct.toFixed(2)}%</div>
                    </div>
                ` : ''}
                ${latestSignal.best_rally_pct !== undefined ? `
                    <div style="background: rgba(255,255,255,0.15); border-radius: 8px; padding: 0.75rem;">
                        <div style="color: rgba(255,255,255,0.7); font-size: 0.75rem; margin-bottom: 4px;">Best Rally</div>
                        <div style="color: white; font-size: 1.1rem; font-weight: 700;">+${latestSignal.best_rally_pct.toFixed(2)}%</div>
                    </div>
                ` : ''}
            </div>
        </div>
        
        <!-- Signal History Timeline -->
        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1.5rem; border: 1px solid rgba(10, 132, 255, 0.2);">
            <h3 style="color: white; margin: 0 0 1rem 0; font-size: 1rem;">
                📈 Signal History (${allSignals.length} signal${allSignals.length !== 1 ? 's' : ''})
            </h3>
            <div id="signalHistoryContainer" style="display: flex; flex-direction: column; gap: 12px;">
                ${allSignals.slice(0, 10).map(sig => {
                    const signalState = sig.rally_state ? rallyStateColors[sig.rally_state] : null;
                    const signalColorEmoji = {
                        'RED': '🔴',
                        'ORANGE': '🟠',
                        'GREEN': '🟢',
                        'YELLOW': '🟡',
                        'PURPLE': '🟣'
                    }[sig.signal_color] || '🟡';
                    
                    // Format date as DD/MM/YYYY to match table
                    const dateObj = new Date(sig.signal_date);
                    const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
                    
                    return `
                        <div style="background: rgba(255,255,255,0.08); border-radius: 8px; padding: 1rem; border-left: 4px solid ${signalState ? signalState.bg : '#6b7280'};">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                <div>
                                    <div style="font-weight: 700; color: white; margin-bottom: 4px;">
                                        ${signalColorEmoji} ${formattedDate}
                                    </div>
                                    <div style="font-size: 0.75rem; color: rgba(255,255,255,0.7);">${sig.signal_type}</div>
                                </div>
                                ${signalState ? `
                                    <span style="background: ${signalState.bg}; color: white; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 600;">
                                        ${signalState.text}
                                    </span>
                                ` : ''}
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; font-size: 0.8rem;">
                                <div>
                                    <span style="color: rgba(255,255,255,0.6);">Entry:</span>
                                    <span style="font-weight: 600; color: white;">${(sig.entry_price * 100).toFixed(2)}p</span>
                                </div>
                                <div>
                                    <span style="color: rgba(255,255,255,0.6);">Return:</span>
                                    <span style="font-weight: 600;" class="${sig.current_return_pct >= 0 ? 'positive' : 'negative'}">
                                        ${sig.current_return_pct >= 0 ? '+' : ''}${sig.current_return_pct.toFixed(1)}%
                                    </span>
                                </div>
                                <div>
                                    <span style="color: rgba(255,255,255,0.6);">Best:</span>
                                    <span style="font-weight: 600; color: #22c55e;">+${sig.best_rally_pct.toFixed(1)}%</span>
                                </div>
                                <div>
                                    <span style="color: rgba(255,255,255,0.6);">Age:</span>
                                    <span style="font-weight: 600; color: white;">${sig.age_days}d</span>
                                </div>
                            </div>
                            <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">
                                ${sig.lock_in_reached ? '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">✓ Lock-in</span>' : ''}
                                ${sig.Rally_Count >= 2 ? `<span style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">⚠ ${sig.Rally_Count} Cycles</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            ${allSignals.length > 10 ? `
                <div style="text-align: center; padding: 1rem 0;">
                    <button onclick="loadMoreSignals('${ticker}')" 
                            onmouseover="this.style.background='var(--primary)'; this.style.color='white'" 
                            onmouseout="this.style.background='rgba(10, 132, 255, 0.3)'; this.style.color='rgba(10, 132, 255, 1)'"
                            style="background: rgba(10, 132, 255, 0.3); color: rgba(10, 132, 255, 1); border: 2px solid var(--primary); padding: 0.75rem 2rem; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; font-size: 0.95rem;">
                        Load More (${allSignals.length - 10} remaining)
                    </button>
                    <div style="color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-top: 0.5rem;">
                        Showing 10 of ${allSignals.length} signals
                    </div>
                </div>
            ` : ''}
        </div>
        
        ${latestSignal.Rally_Count >= 2 ? `
            <div style="background: rgba(251, 191, 36, 0.15); border-left: 4px solid #fbbf24; border-radius: 8px; padding: 1rem; margin-top: 1rem; border: 1px solid rgba(251, 191, 36, 0.3);">
                <h4 style="color: #fbbf24; margin: 0 0 0.5rem 0; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                    ⚠️ Risk Warning
                </h4>
                <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 0.85rem;">
                    Multiple rally cycles detected (${latestSignal.Rally_Count} cycles). This pattern may indicate pump-and-dump behavior or high volatility. Exercise caution.
                </p>
            </div>
        ` : ''}
    `;
        
        console.log('Displaying modal...');
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
        // Load and render price chart
        loadPriceChart(ticker);
    } catch (error) {
        console.error('Error in showSignalTimeline:', error);
        alert('Error loading rally details: ' + error.message);
    }
}

function closeSignalTimeline() {
    const modal = document.getElementById('signalTimelineModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// Track how many signals are currently displayed per ticker
const signalDisplayCount = {};

function loadMoreSignals(ticker) {
    const metadata = allMetadata[ticker];
    if (!metadata || !metadata.all_historical_signals) return;
    
    const allSignals = metadata.all_historical_signals;
    const currentCount = signalDisplayCount[ticker] || 10;
    const newCount = Math.min(currentCount + 10, allSignals.length);
    signalDisplayCount[ticker] = newCount;
    
    // Rally State colors
    const rallyStateColors = {
        'accumulating': { bg: '#6b7280', text: 'Accumulating' },
        'rallying': { bg: '#22c55e', text: 'Rallying' },
        'peaked': { bg: '#ef4444', text: 'Peaked' },
        'pulling_back': { bg: '#3b82f6', text: 'Pulling Back' }
    };
    
    // Render signals from index 10 to newCount
    const container = document.getElementById('signalHistoryContainer');
    const signalsToAdd = allSignals.slice(currentCount, newCount);
    
    signalsToAdd.forEach(sig => {
        const signalState = sig.rally_state ? rallyStateColors[sig.rally_state] : null;
        const signalColorEmoji = {
            'RED': '🔴',
            'ORANGE': '🟠',
            'GREEN': '🟢',
            'YELLOW': '🟡',
            'PURPLE': '🟣'
        }[sig.signal_color] || '🟡';
        
        const dateObj = new Date(sig.signal_date);
        const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
        
        const cardHTML = `
            <div style="background: rgba(255,255,255,0.08); border-radius: 8px; padding: 1rem; border-left: 4px solid ${signalState ? signalState.bg : '#6b7280'};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div>
                        <div style="font-weight: 700; color: white; margin-bottom: 4px;">
                            ${signalColorEmoji} ${formattedDate}
                        </div>
                        <div style="font-size: 0.75rem; color: rgba(255,255,255,0.7);">${sig.signal_type}</div>
                    </div>
                    ${signalState ? `
                        <span style="background: ${signalState.bg}; color: white; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 600;">
                            ${signalState.text}
                        </span>
                    ` : ''}
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; font-size: 0.8rem;">
                    <div>
                        <span style="color: rgba(255,255,255,0.6);">Entry:</span>
                        <span style="font-weight: 600; color: white;">${(sig.entry_price * 100).toFixed(2)}p</span>
                    </div>
                    <div>
                        <span style="color: rgba(255,255,255,0.6);">Return:</span>
                        <span style="font-weight: 600;" class="${sig.current_return_pct >= 0 ? 'positive' : 'negative'}">
                            ${sig.current_return_pct >= 0 ? '+' : ''}${sig.current_return_pct.toFixed(1)}%
                        </span>
                    </div>
                    <div>
                        <span style="color: rgba(255,255,255,0.6);">Best:</span>
                        <span style="font-weight: 600; color: #22c55e;">+${sig.best_rally_pct.toFixed(1)}%</span>
                    </div>
                    <div>
                        <span style="color: rgba(255,255,255,0.6);">Age:</span>
                        <span style="font-weight: 600; color: white;">${sig.age_days}d</span>
                    </div>
                </div>
                <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">
                    ${sig.lock_in_reached ? '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">✓ Lock-in</span>' : ''}
                    ${sig.Rally_Count >= 2 ? `<span style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">⚠ ${sig.Rally_Count} Cycles</span>` : ''}
                </div>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', cardHTML);
    });
    
    // Update or remove the "Load More" button
    const loadMoreButton = container.nextElementSibling;
    if (loadMoreButton) {
        if (newCount >= allSignals.length) {
            // All loaded, remove button
            loadMoreButton.remove();
        } else {
            // Update button text
            loadMoreButton.innerHTML = `
                <button onclick="loadMoreSignals('${ticker}')" 
                        onmouseover="this.style.background='var(--primary)'; this.style.color='white'" 
                        onmouseout="this.style.background='rgba(10, 132, 255, 0.3)'; this.style.color='rgba(10, 132, 255, 1)'"
                        style="background: rgba(10, 132, 255, 0.3); color: rgba(10, 132, 255, 1); border: 2px solid var(--primary); padding: 0.75rem 2rem; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; font-size: 0.95rem;">
                    Load More (${allSignals.length - newCount} remaining)
                </button>
                <div style="color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-top: 0.5rem;">
                    Showing ${newCount} of ${allSignals.length} signals
                </div>
            `;
        }
    }
}

// Close modal on outside click
window.onclick = function(event) {
    const modal = document.getElementById('signalTimelineModal');
    if (event.target === modal) {
        closeSignalTimeline();
    }
};

// ============================================
// PRICE CHART FUNCTIONS
// ============================================

async function loadPriceChart(ticker) {
    console.log(`Loading price chart for ${ticker}`);
    
    const chartDiv = document.getElementById('priceChart');
    if (!chartDiv) {
        console.warn('Chart div not found');
        return;
    }
    
    // Clear loading message immediately
    chartDiv.innerHTML = '';
    
    try {
        // Fetch chart data
        const response = await fetch(`data/charts/${ticker}.json`);
        if (!response.ok) {
            throw new Error(`Chart data not found (${response.status})`);
        }
        
        const chartData = await response.json();
        console.log(`Chart data loaded for ${ticker}:`, chartData.dates.length, 'bars');
        
        // Prepare traces
        const traces = [];
        
        // 1. Candlestick trace for OHLC
        traces.push({
            type: 'candlestick',
            x: chartData.dates,
            open: chartData.open,
            high: chartData.high,
            low: chartData.low,
            close: chartData.close,
            name: cleanTickerDisplay(ticker),
            increasing: { line: { color: '#22c55e' } },
            decreasing: { line: { color: '#ef4444' } },
            hovertext: chartData.dates.map((d, i) => 
                `Date: ${d}<br>Open: £${chartData.open[i].toFixed(4)}<br>High: £${chartData.high[i].toFixed(4)}<br>Low: £${chartData.low[i].toFixed(4)}<br>Close: £${chartData.close[i].toFixed(4)}`
            ),
            hoverinfo: 'text'
        });
        
        // 2. Signal markers (grouped by color)
        const signalsByColor = {
            'RED': { signals: [], name: 'Ultra Crash', color: '#ef4444', symbol: 'triangle-up' },
            'ORANGE': { signals: [], name: 'Extreme Crash', color: '#f97316', symbol: 'triangle-up' },
            'GREEN': { signals: [], name: 'Deep Crash', color: '#22c55e', symbol: 'triangle-up' },
            'YELLOW': { signals: [], name: 'Crash Zone', color: '#eab308', symbol: 'triangle-up' },
            'PURPLE': { signals: [], name: 'Enhanced', color: '#a855f7', symbol: 'triangle-up' }
        };
        
        chartData.signals.forEach(sig => {
            const color = sig.color || 'YELLOW';
            if (signalsByColor[color]) {
                signalsByColor[color].signals.push(sig);
            }
        });
        
        // Helper function to calculate signal position with local context-aware offset
        const calculateSignalPosition = (dateIdx) => {
            if (dateIdx < 0 || dateIdx >= chartData.dates.length) return null;
            try {
                // Calculate local price range (30 days window around signal for context)
                const windowStart = Math.max(0, dateIdx - 15);
                const windowEnd = Math.min(chartData.dates.length, dateIdx + 15);
                const localLows = chartData.low.slice(windowStart, windowEnd);
                const localHighs = chartData.high.slice(windowStart, windowEnd);
                
                if (localLows.length === 0 || localHighs.length === 0) return null;
                
                const localRange = Math.max(...localHighs) - Math.min(...localLows);
                
                // Use 5% of local range as offset (adapts to current price level)
                const localOffset = localRange * 0.05;
                return chartData.low[dateIdx] - localOffset;
            } catch (error) {
                console.warn('Error calculating signal position:', error);
                return null;
            }
        };
        
        // Add signal traces - position below candles with dynamic offset per signal
        Object.entries(signalsByColor).forEach(([color, group]) => {
            if (group.signals.length > 0) {
                // Map each signal to below the low price with context-aware offset
                const yPositions = group.signals.map(s => {
                    const dateIdx = chartData.dates.indexOf(s.date);
                    const pos = calculateSignalPosition(dateIdx);
                    return pos !== null ? pos : s.price; // Fallback to signal price if not found
                });
                
                traces.push({
                    type: 'scatter',
                    mode: 'markers',
                    x: group.signals.map(s => s.date),
                    y: yPositions,
                    name: group.name,
                    marker: {
                        symbol: 'triangle-up',
                        size: 14,
                        color: group.color,
                        line: { width: 1.5, color: 'rgba(255,255,255,0.9)' }
                    },
                    customdata: group.signals.map(s => [s.price, s.comment]),
                    hovertemplate: '<b>%{customdata[1]}</b><br>Date: %{x}<br>Signal Price: £%{customdata[0]:.4f}<extra></extra>'
                });
            }
        });
        
        // Layout configuration
        const isMobile = window.innerWidth < 768;
        const layout = {
            xaxis: {
                type: 'date',
                rangeselector: {
                    buttons: [
                        { 
                            count: 3, 
                            label: '3m', 
                            step: 'month', 
                            stepmode: 'backward'
                        },
                        { 
                            count: 6, 
                            label: '6m', 
                            step: 'month', 
                            stepmode: 'backward'
                        },
                        { 
                            count: 1, 
                            label: '1y', 
                            step: 'year', 
                            stepmode: 'backward'
                        },
                        { 
                            count: 2, 
                            label: '2y', 
                            step: 'year', 
                            stepmode: 'backward'
                        },
                        { 
                            step: 'all', 
                            label: 'All'
                        }
                    ],
                    x: isMobile ? 0.5 : 0,
                    y: isMobile ? -0.30 : 1.02,
                    xanchor: isMobile ? 'center' : 'left',
                    yanchor: 'bottom',
                    bgcolor: 'rgba(10, 20, 40, 0.85)',
                    activecolor: 'rgba(10, 132, 255, 0.7)',
                    font: { color: 'white', size: isMobile ? 9 : 12 },
                    borderwidth: 1,
                    bordercolor: 'rgba(255,255,255,0.3)',
                    pad: { t: isMobile ? 2 : 5, b: isMobile ? 2 : 5 }
                },
                rangeslider: { visible: false },
                gridcolor: 'rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.7)',
                tickangle: isMobile ? -45 : 0,
                tickfont: { size: isMobile ? 9 : 11 },
                nticks: isMobile ? 6 : 10,
                automargin: true,
                tickformat: isMobile ? '%m-%y' : null
            },
            yaxis: {
                title: isMobile ? '£' : 'Price (£)',
                gridcolor: 'rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.7)',
                tickfont: { size: isMobile ? 9 : 11 },
                titlefont: { size: isMobile ? 10 : 12 },
                automargin: true,
                tickformat: isMobile ? '.2f' : '.4f'
            },
            hovermode: 'closest',
            hoverlabel: {
                bgcolor: 'rgba(0, 0, 0, 0.8)',
                bordercolor: 'rgba(255, 255, 255, 0.3)',
                font: { 
                    color: 'white',
                    size: 12,
                    family: 'Arial, sans-serif'
                }
            },
            plot_bgcolor: 'rgba(0,0,0,0.2)',
            paper_bgcolor: 'transparent',
            legend: {
                orientation: 'h',
                yanchor: isMobile ? 'top' : 'bottom',
                y: isMobile ? -0.45 : -0.25,
                xanchor: 'center',
                x: 0.5,
                font: { color: 'white', size: isMobile ? 10 : 12 },
                tracegroupgap: isMobile ? 5 : 10
            },
            margin: { 
                l: isMobile ? 45 : 60, 
                r: isMobile ? 10 : 30, 
                t: isMobile ? 40 : 20, 
                b: isMobile ? 55 : 80 
            },
            autosize: true
        };
        
        // Plot configuration
        const config = {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: isMobile ? ['lasso2d', 'select2d', 'autoScale2d'] : ['lasso2d', 'select2d'],
            modeBarButtonsToAdd: [],
            modeBarPosition: 'top',
            toImageButtonOptions: {
                format: 'png',
                filename: `${ticker}_chart`,
                height: 800,
                width: 1400
            },
            // Better mobile support
            autosizable: true
        };
        
        // Render the chart with 1-year default view (from last data point)
        const lastDate = new Date(chartData.dates[chartData.dates.length - 1]);
        const oneYearAgo = new Date(lastDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        // Set initial x-axis range to 1 year from last data point
        layout.xaxis.range = [
            oneYearAgo.toISOString().split('T')[0], 
            chartData.dates[chartData.dates.length - 1]
        ];
        
        Plotly.newPlot(chartDiv, traces, layout, config).then(() => {
            // Calculate y-axis range for the visible 1-year data INCLUDING signal positions
            const startIdx = chartData.dates.findIndex(d => d >= layout.xaxis.range[0]);
            const endIdx = chartData.dates.findIndex(d => d > layout.xaxis.range[1]);
            const visibleHigh = chartData.high.slice(startIdx, endIdx > 0 ? endIdx : undefined);
            const visibleLow = chartData.low.slice(startIdx, endIdx > 0 ? endIdx : undefined);
            
            // Calculate signal positions for visible range using dynamic offset
            const visibleSignalLows = [];
            chartData.signals.forEach(sig => {
                const dateIdx = chartData.dates.indexOf(sig.date);
                if (dateIdx >= startIdx && (endIdx < 0 || dateIdx < endIdx)) {
                    const pos = calculateSignalPosition(dateIdx);
                    if (pos !== null) visibleSignalLows.push(pos);
                }
            });
            
            const yMin = Math.min(...visibleLow, ...visibleSignalLows);
            const yMax = Math.max(...visibleHigh);
            const padding = (yMax - yMin) * 0.05; // 5% padding
            
            Plotly.relayout(chartDiv, {
                'yaxis.range': [yMin - padding, yMax + padding],
                'yaxis.autorange': false
            });
        });
        
        // Listen for range selector/zoom changes to rescale y-axis
        chartDiv.on('plotly_relayout', function(eventData) {
            // Only respond to x-axis range changes (not y-axis changes we make ourselves)
            if ((eventData['xaxis.range[0]'] || eventData['xaxis.range']) && !eventData['yaxis.range']) {
                // Force axis reset FIRST before any calculations
                Plotly.relayout(chartDiv, {
                    'yaxis.autorange': true
                }).then(() => {
                    const xRange = eventData['xaxis.range'] || [eventData['xaxis.range[0]'], eventData['xaxis.range[1]']];
                    
                    // Find visible data indices with proper handling for "All" timeframe
                    let startIdx = 0;
                    let endIdx = chartData.dates.length;
                    
                    // Find actual start index
                    for (let i = 0; i < chartData.dates.length; i++) {
                        if (chartData.dates[i] >= xRange[0]) {
                            startIdx = i;
                            break;
                        }
                    }
                    
                    // Find actual end index
                    for (let i = startIdx; i < chartData.dates.length; i++) {
                        if (chartData.dates[i] > xRange[1]) {
                            endIdx = i;
                            break;
                        }
                    }
                    
                    // Ensure we have valid range
                    if (startIdx >= 0 && endIdx > startIdx) {
                        const visibleHigh = chartData.high.slice(startIdx, endIdx);
                        const visibleLow = chartData.low.slice(startIdx, endIdx);
                        
                        if (visibleHigh.length > 0 && visibleLow.length > 0) {
                            // Include signal positions in range calculation using dynamic offset
                            const visibleSignalLows = [];
                            chartData.signals.forEach(sig => {
                                const dateIdx = chartData.dates.indexOf(sig.date);
                                if (dateIdx >= startIdx && dateIdx < endIdx) {
                                    const pos = calculateSignalPosition(dateIdx);
                                    if (pos !== null) visibleSignalLows.push(pos);
                                }
                            });
                            
                            const yMin = visibleSignalLows.length > 0 ? 
                                Math.min(...visibleLow, ...visibleSignalLows) : 
                                Math.min(...visibleLow);
                            const yMax = Math.max(...visibleHigh);
                            const padding = (yMax - yMin) * 0.05; // 5% padding
                            
                            // Now set the calculated range
                            Plotly.relayout(chartDiv, {
                                'yaxis.autorange': false,
                                'yaxis.range': [yMin - padding, yMax + padding]
                            });
                        }
                    }
                });
            }
        });
        
        console.log(`✓ Chart rendered: ${chartData.dates.length} bars, 1-year view (${layout.xaxis.range[0]} to ${layout.xaxis.range[1]})`);
        
    } catch (error) {
        console.error('Error loading price chart:', error);
        chartDiv.innerHTML = `
            <div style="color: rgba(255,255,255,0.7); text-align: center; padding: 2rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">📊</div>
                <div>Chart data not available</div>
                <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 0.5rem;">${error.message}</div>
            </div>
        `;
    }
}

// ============================================
// MOBILE NAVIGATION
// ============================================

function toggleMobileNav() {
    const overlay = document.getElementById('mobileNavOverlay');
    const hamburger = document.getElementById('hamburgerMenu');
    
    overlay.classList.toggle('active');
    hamburger.classList.toggle('active');
    
    // Prevent body scroll when menu is open
    if (overlay.classList.contains('active')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

// ============================================
// ONBOARDING DRAWER
// ============================================

function openOnboardingDrawer() {
    const drawer = document.getElementById('onboardingDrawer');
    drawer.classList.add('active');
    drawer.setAttribute('aria-hidden', 'false');
    
    // Smooth scroll to bottom
    setTimeout(() => {
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
    }, 100);
}

function closeOnboardingDrawer() {
    const drawer = document.getElementById('onboardingDrawer');
    drawer.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
}

// AI Report Loading Function
function loadAIReport(ticker) {
    // Create modal overlay
    const modalHTML = `
        <div class="modal" id="aiReportModal" style="display: flex; align-items: center; justify-content: center;">
            <div class="modal-content" style="
                max-width: 650px;
                width: 90%;
                padding: 2rem;
                text-align: center;
                background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%);
                position: relative;
            ">
                <div style="margin-bottom: 2rem;">
                    <h3 style="color: white; font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 700;">
                        ⚡ AI Smart Report
                    </h3>
                    <p style="color: rgba(255, 255, 255, 0.7); font-size: 1rem; margin-bottom: 1rem;">
                        Analyzing <strong style="color: #667eea;">${ticker}</strong> with Engine V4
                    </p>
                    
                    <!-- Progress Dialog Box -->
                    <div id="aiProgressDialog" style="
                        background: rgba(0, 0, 0, 0.3);
                        border: 1px solid rgba(102, 126, 234, 0.3);
                        border-radius: 12px;
                        padding: 2rem 1rem 1.2rem 1rem;
                        margin: 1.5rem 0;
                        min-height: 80px;
                        display: flex;
                        align-items: center;
                        justify-content: flex-start;
                        text-align: left;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                        position: relative;
                    ">
                        <!-- Working indicator inside dialog top-left -->
                        <div style="
                            position: absolute;
                            top: 0.6rem;
                            left: 1rem;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            z-index: 10;
                        ">
                            <div style="
                                width: 6px;
                                height: 6px;
                                background: #667eea;
                                border-radius: 50%;
                                animation: pulse 1s ease-in-out infinite;
                                box-shadow: 0 0 6px rgba(102, 126, 234, 0.6);
                            "></div>
                            <span style="
                                color: rgba(255, 255, 255, 0.6);
                                font-size: 0.65rem;
                                font-weight: 600;
                                text-transform: uppercase;
                                letter-spacing: 0.8px;
                                white-space: nowrap;
                            ">Working...</span>
                        </div>
                        <div style="
                            position: relative;
                            width: 36px;
                            height: 36px;
                            margin-right: 14px;
                            flex-shrink: 0;
                        ">
                            <div style="
                                position: absolute;
                                width: 100%;
                                height: 100%;
                                border-radius: 50%;
                                border: 2px solid transparent;
                                border-top-color: #667eea;
                                border-right-color: #764ba2;
                                animation: spin 1s linear infinite;
                            "></div>
                            <div style="
                                position: absolute;
                                top: 50%;
                                left: 50%;
                                transform: translate(-50%, -50%);
                                width: 20px;
                                height: 20px;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                border-radius: 50%;
                                animation: pulse 1.5s ease-in-out infinite;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="white" stroke-width="3" stroke-linecap="round"/>
                                </svg>
                            </div>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <span id="aiProgressText" style="
                                color: rgba(255, 255, 255, 0.95);
                                font-size: 0.92rem;
                                font-family: 'Courier New', monospace;
                                letter-spacing: 0.3px;
                                line-height: 1.5;
                                display: block;
                                word-wrap: break-word;
                                overflow-wrap: break-word;
                            ">Initializing neural network...</span>
                        </div>
                    </div>
                </div>
                <button 
                    onclick="closeAIReportModal()"
                    style="
                        padding: 0.75rem 2rem;
                        background: rgba(10, 132, 255, 0.3);
                        color: rgba(10, 132, 255, 1);
                        border: 2px solid var(--primary);
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.95rem;
                        font-weight: 600;
                        transition: all 0.2s ease;
                    "
                    onmouseover="this.style.background='var(--primary)'; this.style.color='white'"
                    onmouseout="this.style.background='rgba(10, 132, 255, 0.3)'; this.style.color='rgba(10, 132, 255, 1)'"
                >
                    Close
                </button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add CSS animation for spinner if not already present
    if (!document.getElementById('spinnerStyle')) {
        const style = document.createElement('style');
        style.id = 'spinnerStyle';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            /* Mobile responsive adjustments for AI progress dialog */
            @media (max-width: 600px) {
                #aiReportModal .modal-content {
                    padding: 1.5rem 1rem !important;
                    width: 95% !important;
                }
                
                #aiReportModal h3 {
                    font-size: 1.2rem !important;
                }
                
                #aiReportModal p {
                    font-size: 0.85rem !important;
                }
                
                #aiProgressDialog {
                    padding: 1.8rem 0.75rem 1rem 0.75rem !important;
                    min-height: 75px !important;
                }
                
                #aiProgressText {
                    font-size: 0.75rem !important;
                    letter-spacing: 0.2px !important;
                    line-height: 1.4 !important;
                }
            }
            
            @media (max-width: 400px) {
                #aiReportModal h3 {
                    font-size: 1rem !important;
                }
                
                #aiReportModal p {
                    font-size: 0.75rem !important;
                }
                
                #aiProgressText {
                    font-size: 0.7rem !important;
                    letter-spacing: 0.1px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Start progress animation
    const progressMessages = [
        'Initializing neural network...',
        `Loading historical ticker data for ${ticker}...`,
        'Establishing secure data pipeline...',
        'Fetching real-time market indicators...',
        'Gathering sentiment intelligence from multiple sources...',
        'Parsing OHLC candlestick patterns...',
        'Analyzing volume spike anomalies...',
        'Computing RSI momentum trajectories...',
        'Cross-referencing sector correlations...',
        'Detecting key support & resistance levels...',
        'Evaluating momentum divergence signals...',
        'Synthesizing multi-timeframe technical signals...',
        'Calculating risk-adjusted performance metrics...',
        'Running Monte Carlo probability simulations...',
        'Applying deep learning pattern recognition models...',
        'Compiling comprehensive analytical report...',
        'Finalizing AI-powered predictions...'
    ];
    
    let messageIndex = 0;
    const progressText = document.getElementById('aiProgressText');
    
    const progressInterval = setInterval(() => {
        if (messageIndex < progressMessages.length) {
            progressText.textContent = progressMessages[messageIndex];
            messageIndex++;
        } else {
            // Loop back to beginning
            messageIndex = 0;
        }
    }, 1400); // Change message every 1.4 seconds
    
    // Store interval ID for cleanup
    window.aiProgressInterval = progressInterval;
    
    // After 10 seconds, show final "waiting for agent" message and keep modal open
    setTimeout(() => {
        clearInterval(progressInterval);
        progressText.textContent = 'Awaiting V4 Engine Agent response............';
        
        // Add animated dots
        let dotCount = 0;
        window.aiProgressInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            const dots = '.'.repeat(dotCount);
            progressText.textContent = `Awaiting V4 Engine Agent response${dots.padEnd(12, '.')}`;
        }, 500);
    }, 10000); // 10 seconds
}

function closeAIReportModal() {
    // Clear progress interval
    if (window.aiProgressInterval) {
        clearInterval(window.aiProgressInterval);
        window.aiProgressInterval = null;
    }
    
    const modal = document.getElementById('aiReportModal');
    if (modal) {
        modal.remove();
    }
}

// Close drawer when clicking outside on mobile
document.addEventListener('click', function(event) {
    const drawer = document.getElementById('onboardingDrawer');
    const isClickInside = drawer && drawer.contains(event.target);
    const isTriggerButton = event.target.closest('.how-to-use-btn');
    
    if (drawer.classList.contains('active') && !isClickInside && !isTriggerButton) {
        closeOnboardingDrawer();
    }
});

// Scroll-to-top button behavior
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', function() {
    const scrollBtns = Array.from(document.querySelectorAll('.scroll-top-btn'));
    if (!scrollBtns.length) return;

    // Attach click handler to all scroll buttons
    scrollBtns.forEach(btn => btn.addEventListener('click', scrollToTop));

    // Show floating button(s) after scrolling down a bit
    window.addEventListener('scroll', function() {
        const shouldShow = window.scrollY > 300;
        scrollBtns.forEach(btn => {
            // inline variant should always be visible (it has class 'inline')
            if (btn.classList.contains('inline')) return;

            if (shouldShow) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
        });
    });
});

// ============================================
// STICKY TABLE HEADER (Fixed Clone - CMC Style)
// ============================================
function initStickyTableHeader() {
    const originalTable = document.querySelector('.signals-table');
    const originalThead = originalTable?.querySelector('thead');
    if (!originalTable || !originalThead) {
        console.log('Sticky header: waiting for table...');
        return;
    }

    // Check if already initialized
    if (document.querySelector('.signals-table-sticky-header')) {
        console.log('Sticky header: already initialized');
        return;
    }

    console.log('Sticky header: initializing...');

    // Create sticky header container
    const stickyContainer = document.createElement('div');
    stickyContainer.className = 'signals-table-sticky-header';
    
    // Clone the table structure with just the header
    const clonedTable = document.createElement('table');
    clonedTable.className = 'signals-table';
    const clonedThead = originalThead.cloneNode(true);
    clonedTable.appendChild(clonedThead);
    stickyContainer.appendChild(clonedTable);
    
    document.body.appendChild(stickyContainer);

    // Show/hide sticky header based on scroll position
    const checkSticky = () => {
        const tableRect = originalTable.getBoundingClientRect();
        const originalTheadRect = originalThead.getBoundingClientRect();
        
        // Responsive threshold: mobile (90px header) vs desktop (145px header)
        const isMobile = window.innerWidth <= 768;
        const threshold = isMobile ? 95 : 150;
        
        // Show sticky when original header scrolls past top (earlier detection)
        if (originalTheadRect.top <= threshold && tableRect.bottom > 200) {
            stickyContainer.classList.add('visible');
            
            // Match container positioning
            const originalWrapper = document.querySelector('.signals-table-wrapper');
            if (originalWrapper) {
                const wrapperRect = originalWrapper.getBoundingClientRect();
                
                // On mobile, use full available width and position from edge
                if (isMobile) {
                    const bodyPaddingLeft = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
                    stickyContainer.style.width = (window.innerWidth - bodyPaddingLeft * 2) + 'px';
                    stickyContainer.style.left = bodyPaddingLeft + 'px';
                } else {
                    stickyContainer.style.width = wrapperRect.width + 'px';
                    stickyContainer.style.left = wrapperRect.left + 'px';
                }
                stickyContainer.style.right = 'auto';
            }
            
            // Match widths of individual columns precisely
            const originalThs = originalThead.querySelectorAll('th');
            const clonedThs = clonedThead.querySelectorAll('th');
            
            // Set table to match original table width
            const originalTableWidth = originalTable.offsetWidth;
            clonedTable.style.width = originalTableWidth + 'px';
            
            originalThs.forEach((th, index) => {
                if (clonedThs[index]) {
                    const computedWidth = th.getBoundingClientRect().width;
                    clonedThs[index].style.width = computedWidth + 'px';
                    clonedThs[index].style.minWidth = computedWidth + 'px';
                    clonedThs[index].style.maxWidth = computedWidth + 'px';
                }
            });
        } else {
            stickyContainer.classList.remove('visible');
        }
    };

    // Check on scroll
    window.addEventListener('scroll', checkSticky, { passive: true });
    window.addEventListener('resize', checkSticky, { passive: true });
    
    console.log('Sticky header: initialized successfully');
    
    // Initial check after a brief delay
    setTimeout(checkSticky, 100);
}

// Try to initialize after DOM loads
document.addEventListener('DOMContentLoaded', initStickyTableHeader);

// Also try after a delay in case table loads late
setTimeout(initStickyTableHeader, 1000);
setTimeout(initStickyTableHeader, 2000);

