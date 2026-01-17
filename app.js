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
    
    // Initialize view
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
    const totalTickersEl = document.getElementById('totalTickers');
    if (totalTickersEl) totalTickersEl.textContent = totalTracked > 600 ? totalTracked : '600+';
    
    // Crash signals generated
    const totalSignalsEl = document.getElementById('totalSignals');
    if (totalSignalsEl) totalSignalsEl.textContent = dashboardStats.total_signals || 0;
    
    // Purple combos
    const purpleCountEl = document.getElementById('purpleCount');
    if (purpleCountEl) purpleCountEl.textContent = dashboardStats.signal_colors?.PURPLE || 0;
    const redCountEl = document.getElementById('redCount');
    if (redCountEl) redCountEl.textContent = dashboardStats.signal_colors?.RED || 0;
    
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
// GROUPING
// ============================================

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
    
    // Render compressed mode
    renderCompressedMode(filteredSignals, tbody);
    
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
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                    <div>${signalBadges}</div>
                    
                    <!-- Chart icon button -->
                    <button 
                        class="chart-icon-button" 
                        onclick="event.stopPropagation(); showSignalTimeline('${ticker}')"
                        title="View Price Chart"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                        </svg>
                    </button>
                </div>
                
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
                // If no market cap data, include in results (don't filter out)
                marketCapMatch = true;
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
        document.body.style.overflow = '';
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
        const header = document.getElementById('signalTimelineHeader');
        
        if (!modal || !content || !header) {
            console.error('Modal elements not found!');
            return;
        }
        
        const latestSignal = metadata.latest_signal || {};
        const allSignals = metadata.all_historical_signals || [];
        
        // Get the MOST RECENT signal from all_historical_signals (lowest age_days value)
        const mostRecentHistoricalSignal = allSignals.length > 0 ? allSignals.reduce((min, sig) => {
            const minAge = min.age_days || Infinity;
            const sigAge = sig.age_days || Infinity;
            return sigAge < minAge ? sig : min;
        }) : {};
        
        // Merge latest_signal with the most recent historical signal to get all fields including correct age_days
        const completeLatestSignal = { ...mostRecentHistoricalSignal, ...latestSignal };
        
        // Rally State colors and labels
        const rallyStateColors = {
        'accumulating': { bg: '#6b7280', text: 'Accumulating' },
        'rallying': { bg: '#22c55e', text: 'Rallying' },
        'peaked': { bg: '#ef4444', text: 'Peaked' },
        'pulling_back': { bg: '#3b82f6', text: 'Pulling Back' }
        };
        
        const currentState = latestSignal.rally_state ? rallyStateColors[latestSignal.rally_state] : null;
        
        // Signal color mapping for tile background
        const signalColorMap = {
            'RED': { bg: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', label: 'Ultra Crash' },
            'ORANGE': { bg: '#f97316', borderColor: 'rgba(249, 115, 22, 0.3)', label: 'Extreme Crash' },
            'GREEN': { bg: '#22c55e', borderColor: 'rgba(34, 197, 94, 0.3)', label: 'Deep Crash' },
            'YELLOW': { bg: '#eab308', borderColor: 'rgba(234, 179, 8, 0.3)', label: 'Crash Zone' },
            'PURPLE': { bg: '#a855f7', borderColor: 'rgba(168, 85, 247, 0.3)', label: 'Enhanced' }
        };
        
        const signalColor = completeLatestSignal.signal_color || 'YELLOW';
        const signalColorStyle = signalColorMap[signalColor] || signalColorMap['YELLOW'];
        
        // Extract company info for header
        const companyInfo = metadata.company_info || {};
        const basics = metadata.basics || {};
        const stats = metadata.stats || {};
        const tickerInfo = tickerLookup[ticker] || {};
        
        // Get market cap in proper format
        const marketCapCandidate = getMarketCapCandidate(ticker, metadata, tickerInfo);
        const formattedMarketCap = formatMarketCap(marketCapCandidate);
        
        // Get current price (pence-aware)
        const currentPriceVal = getPriceFieldForTicker(ticker, basics, 'current_price');
        const fmtCurrentPrice = (currentPriceVal !== undefined && currentPriceVal !== null && !isNaN(currentPriceVal)) ? Number(currentPriceVal).toFixed(4) : '-';
        
        // Set HEADER content (fixed)
        header.innerHTML = `
        <!-- COMPANY INFO HEADER -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; background: rgb(26, 35, 54); box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-bottom: 1px solid rgba(10, 132, 255, 0.4); padding: 0.6rem 1.5rem; margin: 0; width: 100%;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; width: 100%; overflow: hidden;">
                <!-- Ticker & Company Name (Left) -->
                <div style="flex: 1 1 auto; min-width: 100px; max-width: 180px;">
                    <div style="color: white; font-size: 0.95rem; font-weight: 800; letter-spacing: 0.5px;">${cleanTickerDisplay(ticker)}</div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; line-height: 1; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${companyInfo.name || 'Company'}</div>
                </div>
                
                <!-- Key Metrics (Center) - 4 columns -->
                <div style="display: flex; gap: 0.5rem; align-items: center; flex: 2 1 auto; overflow: hidden;">
                    <!-- Current Price (with currency) -->
                    <div style="text-align: center; min-width: 60px; flex-shrink: 0;">
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1;">
                            Price <span style="color: #f59e0b; font-size: 0.5rem; font-weight: 600;">${companyInfo.currency || 'GBP'}</span>
                        </div>
                        <div style="color: white; font-size: 0.85rem; font-weight: 800; line-height: 1.1; margin-top: 1px;">${fmtCurrentPrice}p</div>
                    </div>
                    
                    <!-- Market Cap -->
                    <div style="text-align: center; min-width: 55px; flex-shrink: 0;">
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1;">Cap</div>
                        <div style="color: #10b981; font-size: 0.85rem; font-weight: 800; line-height: 1.1; margin-top: 1px;">${formattedMarketCap}</div>
                    </div>
                    
                    <!-- Exchange (combined Market + Exchange) -->
                    <div style="text-align: center; min-width: 60px; flex-shrink: 0;">
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1;">Exchange</div>
                        <div style="font-size: 0.75rem; font-weight: 700; line-height: 1.1; margin-top: 1px;">
                            <span style="color: #06b6d4;">${companyInfo.exchange || 'LSE'}</span>
                            <span style="color: #a855f7;"> ${companyInfo.market || 'AIM'}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Details Row -->
        <div style="display: flex; gap: 1.5rem; font-size: 0.65rem; background: rgb(26, 35, 54); box-shadow: 0 2px 6px rgba(0,0,0,0.2); border-bottom: 1px solid rgba(10, 132, 255, 0.2); padding: 0.35rem 1.5rem 0.4rem 1.5rem; margin: 0; text-align: left;">
            <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 100px;">
                <span style="color: #667eea; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 500; flex-shrink: 0;">Sector:</span>
                <span style="color: white; font-weight: 700; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${companyInfo.sector || '-'}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem; flex: 1; overflow: hidden;">
                <span style="color: #667eea; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 500; flex-shrink: 0;">Ind:</span>
                <span style="color: white; font-weight: 700; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${companyInfo.industry || '-'}</span>
            </div>
        </div>
        `;
        
        // Set CONTENT
        content.innerHTML = `
        <!-- Content starts here with proper spacing and padding -->
        <div style="padding: 1.5rem; padding-top: 1rem;">
        
        <!-- 5-Year Price Chart -->
        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; border: 1px solid rgba(10, 132, 255, 0.2);">
            <h3 style="color: white; margin: 0 0 0.8rem 0; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; font-weight: 600;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex-shrink:0;">
                    <path d="M3 17v3h18v-14" stroke="rgb(10,132,255)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    <polyline points="3 13 8 8 13 12 21 4" stroke="rgb(10,132,255)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                </svg>
                ${cleanTickerDisplay(ticker)} Price Chart</h3>
            <div id="priceChart" style="width: 100%; height: 300px; min-height: 250px;"></div>
            
            <!-- 52-Week High/Low Plain Text -->
            <div style="margin-top: 0.8rem; text-align: center; font-size: 0.75rem; color: rgba(255,255,255,0.7);">
                <div style="color: white; font-weight: 600; margin-bottom: 4px;">52-Week Range</div>
                <div>High: ${basics.week_52_high ? basics.week_52_high + 'p' : '-'} (${basics.week_52_high_date ? new Date(basics.week_52_high_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'})</div>
                <div>Low: ${basics.week_52_low ? basics.week_52_low + 'p' : '-'} (${basics.week_52_low_date ? new Date(basics.week_52_low_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'})</div>
            </div>
        </div>
        
        <!-- PERFORMANCE TILE - SIMPLE SPLIT -->
        <style>
            /* Scoped performance tile tweaks: left-justify label and value, remove separators, responsive sizing */
            #performance-tile .metadata-item { border-bottom: none !important; padding: 8px 0; display: flex; align-items: center; gap: 0.75rem; justify-content: flex-start; }
            /* Label smaller than value */
            #performance-tile .metadata-label { color: rgba(255,255,255,0.75); flex: 0 0 auto; font-size: 0.85rem; }
            #performance-tile .metadata-value { color: white; font-weight: 700; text-align: left; flex: 0 0 auto; font-size: 1.05rem; }
            @media (max-width: 900px) {
                #performance-tile { padding: 0.6rem; }
                #performance-tile .metadata-label { font-size: 0.78rem; }
                #performance-tile .metadata-value { font-size: 0.95rem; }
                #performance-tile h3 { font-size: 0.95rem; }
            }
        </style>
        <div id="performance-tile" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; color: white; border: 1px solid rgba(255,255,255,0.1);">
            <h3 style="color: white; margin: 0 0 0.75rem 0; font-size: 0.9rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style="flex-shrink:0;">
                    <path d="M3 14h3v4H3zM10 8h3v10h-3zM17 4h3v14h-3z" fill="#06b6d4" />
                </svg>
                Performance
            </h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <!-- Left Column -->
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <div class="metadata-item">
                        <span class="metadata-label">Signals</span>
                        <span class="metadata-value" style="color: white;">${allSignals.length || 30}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Win Rate</span>
                        <span class="metadata-value" style="color: white;">100%</span>
                    </div>
                </div>
                <!-- Right Column -->
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <div class="metadata-item">
                        <span class="metadata-label">Best Date</span>
                        <span class="metadata-value" style="color: white;">${(metadata.best_historical_signal && metadata.best_historical_signal.signal_date) ? new Date(metadata.best_historical_signal.signal_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : 'N/A'}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Peak Rally</span>
                        <span class="metadata-value" style="color: white;">${(metadata.best_historical_signal && metadata.best_historical_signal.rally_pct) ? ('+' + metadata.best_historical_signal.rally_pct.toFixed(1) + '%') : '-'} <span style="color: rgba(255,255,255,0.5); font-weight: 400; font-size: 0.7rem;">(${(metadata.best_historical_signal && metadata.best_historical_signal.days_to_peak) ? metadata.best_historical_signal.days_to_peak + 'd' : '-'})</span></span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">${cleanTickerDisplay(ticker)} Avg Rally</span>
                        <span class="metadata-value" style="color: white;">${stats.avg_rally_pct ? stats.avg_rally_pct.toFixed(0) + '%' : '-'}</span>
                    </div>
                </div>
            </div>
        </div>

        ${metadata && metadata.risk_flags && metadata.risk_flags.length > 0 ? `
        <!-- RISK FACTORS WARNING TILE -->
        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; border: 1px solid rgba(255,255,255,0.1);">
            <h3 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; font-weight: 600; color: #fbbf24; display:flex; align-items:center; gap:8px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style="flex-shrink:0;">
                    <path d="M12 2 2 20h20L12 2z" stroke="#f59e0b" stroke-width="1.2" fill="rgba(251,191,36,0.08)" stroke-linejoin="round"/>
                    <path d="M12 8v4" stroke="#f59e0b" stroke-width="1.6" stroke-linecap="round"/>
                    <circle cx="12" cy="16" r="0.8" fill="#f59e0b"/>
                </svg>
                Risk Factors
            </h3>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                ${metadata.risk_flags.map(flag => `
                    <span style="background: rgba(239, 68, 68, 0.2); color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; border: 1px solid rgba(239, 68, 68, 0.4);">
                        ${flag.replace(/_/g, ' ')}
                    </span>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        <!-- CURRENT SIGNAL - COMPACT SINGLE TILE -->
        <div style="background: linear-gradient(135deg, rgba(${parseInt(signalColorStyle.bg.slice(1,3), 16)}, ${parseInt(signalColorStyle.bg.slice(3,5), 16)}, ${parseInt(signalColorStyle.bg.slice(5,7), 16)}, 0.1), rgba(10, 132, 255, 0.05)); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; color: white; border: 1px solid ${signalColorStyle.borderColor};">
            <h3 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; font-weight: 600; display:flex; align-items:center; gap:8px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style="flex-shrink:0;">
                    <path d="M3 18h3v-6H3zM9 12h3v6H9zM15 8h3v10h-3z" fill="#a855f7" />
                </svg>
                Latest Signal
            </h3>
            
            <!-- Latest Signal Compact Tile (like History format) -->
            <div style="background: rgba(255,255,255,0.08); border-radius: 8px; padding: 1rem; border-left: 4px solid ${signalColorStyle.bg};">
                <!-- Header: Date + Badges -->
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
                    <div>
                        <div style="font-weight: 700; color: white; margin-bottom: 4px;">
                            ${completeLatestSignal.date || completeLatestSignal.signal_date || 'N/A'}
                        </div>
                        <div style="font-size: 0.7rem; color: rgba(255,255,255,0.7); display: flex; gap: 6px; flex-wrap: wrap;">
                            ${completeLatestSignal.signal_type ? `<span style="background: ${signalColorStyle.bg}; color: white; padding: 2px 6px; border-radius: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2px; font-size: 0.65rem;">${completeLatestSignal.signal_type}</span>` : ''}
                            ${currentState ? `<span style="background: ${currentState.bg}; color: white; padding: 2px 6px; border-radius: 3px; font-weight: 600; font-size: 0.65rem;">${currentState.text}</span>` : ''}
                        </div>
                    </div>
                    ${completeLatestSignal.lock_in_reached ? `<span style="display:inline-flex; align-items:center; gap:6px; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid #10b981; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" aria-hidden=\"true\"><path d=\"M20 6L9 17l-5-5\" stroke=\"#10b981\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>Lock-in</span>` : ''}
                </div>
                
                <!-- Compact Metrics Grid -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.75rem; font-size: 0.8rem;">
                    <!-- Entry Price -->
                    <div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 3px;">Entry:</div>
                        <div style="font-weight: 600; color: white;">${completeLatestSignal.price ? (completeLatestSignal.price * 100).toFixed(2) : completeLatestSignal.entry_price ? (completeLatestSignal.entry_price * 100).toFixed(2) : '-'}p</div>
                    </div>
                    
                    <!-- Current P&L -->
                    <div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 3px;">P&L:</div>
                        <div style="font-weight: 600; color: ${completeLatestSignal.current_pnl_pct >= 0 ? '#10b981' : '#ef4444'};">${completeLatestSignal.current_pnl_pct === 0 ? '0%' : (completeLatestSignal.current_pnl_pct >= 0 ? '+' : '') + completeLatestSignal.current_pnl_pct.toFixed(1) + '%'}</div>
                    </div>
                    
                    <!-- Best Rally -->
                    <div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 3px;">Best:</div>
                        <div style="font-weight: 600; color: #22c55e;">${completeLatestSignal.best_rally_pct !== undefined ? '+' + completeLatestSignal.best_rally_pct.toFixed(1) + '%' : '-'}</div>
                    </div>
                    
                    <!-- Signal Age -->
                    <div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 3px;">Age:</div>
                        <div style="font-weight: 600; color: #06b6d4;">${completeLatestSignal.age_days || '0'}d</div>
                    </div>
                    
                    <!-- Cycle Position -->
                    <div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 3px;">Cycle:</div>
                        <div style="font-weight: 600; color: #fbbf24;">${completeLatestSignal.cycle_position ? (completeLatestSignal.cycle_position * 100).toFixed(0) : '-'}%</div>
                    </div>
                    
                    <!-- AI Confidence -->
                    <div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 3px;">AI Score:</div>
                        <div style="font-weight: 600; color: #667eea;">${completeLatestSignal.ai_score ? completeLatestSignal.ai_score.toFixed(1) : '-'}/10</div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Signal History Timeline -->
        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1rem; margin-top: 1rem; border: 1px solid rgba(10, 132, 255, 0.2);">
            <h3 style="color: white; margin: 0 0 1rem 0; font-size: 1.05rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style="flex-shrink:0;">
                    <circle cx="12" cy="8" r="3" stroke="#f59e0b" stroke-width="1.4" fill="rgba(251,191,36,0.06)"/>
                    <path d="M12 11v6" stroke="#f59e0b" stroke-width="1.4" stroke-linecap="round"/>
                    <path d="M8 17h8" stroke="#f59e0b" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
                Signal History <span style="background: rgba(10, 132, 255, 0.3); padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: 600; color: #06b6d4;">${allSignals.length}</span>
            </h3>
            <div id="signalHistoryContainer" style="display: flex; flex-direction: column; gap: 0.75rem;">
                ${allSignals.sort((a, b) => new Date(b.signal_date) - new Date(a.signal_date)).slice(0, 10).map(sig => {
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
                        <div style="background: rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem; border-left: 4px solid ${signalState ? signalState.bg : '#6b7280'}; transition: background 0.2s;">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.6rem; flex-wrap: wrap; gap: 8px;">
                                <div style="flex: 1; min-width: 150px;">
                                    <div style="font-weight: 700; color: white; margin-bottom: 3px; font-size: 0.9rem;">
                                        ${signalColorEmoji} ${formattedDate}
                                    </div>
                                    <div style="font-size: 0.7rem; color: rgba(255,255,255,0.7);">${sig.signal_type}</div>
                                </div>
                                ${signalState ? `
                                    <span style="background: ${signalState.bg}; color: white; padding: 3px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 600; white-space: nowrap;">
                                        ${signalState.text}
                                    </span>
                                ` : ''}
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 6px; font-size: 0.75rem;">
                                <div>
                                    <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 2px;">Entry</div>
                                    <div style="font-weight: 600; color: white;">${(sig.entry_price * 100).toFixed(2)}p</div>
                                </div>
                                <div>
                                    <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 2px;">Return</div>
                                    <div style="font-weight: 600;" class="${sig.current_return_pct >= 0 ? 'positive' : 'negative'}">
                                        ${sig.current_return_pct >= 0 ? '+' : ''}${sig.current_return_pct.toFixed(1)}%
                                    </div>
                                </div>
                                <div>
                                    <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 2px;">Best</div>
                                    <div style="font-weight: 600; color: #22c55e;">+${sig.best_rally_pct.toFixed(1)}%</div>
                                </div>
                                <div>
                                    <div style="color: rgba(255,255,255,0.6); font-size: 0.65rem; margin-bottom: 2px;">Age</div>
                                    <div style="font-weight: 600; color: #06b6d4;">${sig.age_days}d</div>
                                </div>
                            </div>
                            <div style="margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; font-size: 0.65rem;">
                                ${sig.lock_in_reached ? '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; padding: 2px 6px; border-radius: 3px; font-weight: 600;">✓ Lock-in</span>' : ''}
                                ${sig.Rally_Count >= 2 ? `<span style="display:inline-flex; align-items:center; gap:6px; background: rgba(251, 191, 36, 0.12); color: #fbbf24; border: 1px solid #fbbf24; padding: 4px 8px; border-radius: 6px; font-weight: 700;">` +
                                    `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" aria-hidden=\"true\"><path d=\"M12 2 2 20h20L12 2z\" stroke=\"#f59e0b\" stroke-width=\"1.2\" fill=\"rgba(251,191,36,0.08)\" stroke-linejoin=\"round\"/><path d=\"M12 8v4\" stroke=\"#f59e0b\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg>` +
                                    ` ${sig.Rally_Count}x</span>` : ''}
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
                <h4 style="color: #fbbf24; margin: 0 0 0.5rem 0; font-size: 0.9rem; display: flex; align-items: center; gap: 8px;">
                    <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" aria-hidden=\"true\" style=\"flex-shrink:0;\"><path d=\"M12 2 2 20h20L12 2z\" stroke=\"#f59e0b\" stroke-width=\"1.2\" fill=\"rgba(251,191,36,0.08)\" stroke-linejoin=\"round\"/><path d=\"M12 8v4\" stroke=\"#f59e0b\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg>
                    Risk Warning
                </h4>
                <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 0.85rem;">
                    Multiple rally cycles detected (${latestSignal.Rally_Count} cycles). This pattern may indicate pump-and-dump behavior or high volatility. Exercise caution.
                </p>
            </div>
        ` : ''}
        </div>
    `;
        
        console.log('Displaying modal...');
        modal.style.display = 'flex';
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
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        // Clear any remaining event listeners
        const content = document.getElementById('signalTimelineContent');
        if (content) {
            content.innerHTML = '';
        }
        const header = document.getElementById('signalTimelineHeader');
        if (header) {
            header.innerHTML = '';
        }
    }
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
                            count: 4, 
                            label: '4y', 
                            step: 'year', 
                            stepmode: 'backward'
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
async function loadAIReport(ticker) {
    const isMobile = window.innerWidth < 768;
    const reportPath = `data/apex_reports/${ticker}_profile.html`;
    
    // Create modal overlay with loader
    const modalHTML = `
        <div class="modal" id="aiReportModal" style="
            display: flex; 
            align-items: center; 
            justify-content: center;
            animation: fadeIn 0.3s ease;
        ">
            <!-- Loader Container (shown first) -->
            <div id="apexLoaderContainer" class="modal-content" style="
                max-width: 650px;
                width: 90%;
                padding: 2rem;
                text-align: center;
                background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%);
                position: relative;
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            ">
                <div style="margin-bottom: 2rem; position: relative;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin-bottom: 0.5rem;">
                        <h3 style="color: white; font-size: 1.5rem; margin: 0; font-weight: 700;">
                            ⚡ AI Smart Report
                        </h3>
                        <!-- APEX Score Display -->
                        <div id="apexScoreDisplay" style="
                            background: rgba(255, 255, 255, 0.15);
                            border: 1px solid rgba(102, 126, 234, 0.4);
                            border-radius: 12px;
                            padding: 0.5rem 1rem;
                            display: flex;
                            align-items: center;
                            gap: 0.5rem;
                            min-width: 80px;
                            justify-content: center;
                        ">
                            <span style="font-size: 1.3rem;">△</span>
                            <span id="apexScore" style="color: rgba(255, 255, 255, 0.9); font-size: 1rem; font-weight: 600;">--</span>
                        </div>
                    </div>
                    <p style="color: rgba(255, 255, 255, 0.7); font-size: 1rem; margin: 0.5rem 0 1rem 0;">
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
                        <!-- Working indicator -->
                        <div style="
                            position: absolute;
                            top: 0.6rem;
                            left: 1rem;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            z-index: 10;
                            margin-bottom: 0.5rem;
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
                        <!-- Progress text -->
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
            </div>
            
            <!-- Report Container (shown after loader) -->
            <div id="apexReportContainer" style="
                max-width: ${isMobile ? '100%' : '95vw'};
                width: ${isMobile ? '100%' : '95%'};
                max-height: 95vh;
                background: white;
                border-radius: ${isMobile ? '0' : '20px'};
                overflow: hidden;
                position: relative;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                opacity: 0;
                transform: scale(0.9);
                transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                pointer-events: none;
            ">
                <button onclick="closeAIReportModal()" style="
                    position: absolute;
                    top: ${isMobile ? '10px' : '15px'};
                    right: ${isMobile ? '10px' : '15px'};
                    z-index: 10000;
                    background: rgba(0,0,0,0.7);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: ${isMobile ? '36px' : '40px'};
                    height: ${isMobile ? '36px' : '40px'};
                    cursor: pointer;
                    font-size: ${isMobile ? '18px' : '20px'};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                " onmouseover="this.style.background='rgba(239,68,68,0.9)'; this.style.transform='scale(1.1)'" 
                   onmouseout="this.style.background='rgba(0,0,0,0.7)'; this.style.transform='scale(1)'">✕</button>
                <iframe 
                    id="apexReportIframe"
                    src="${reportPath}"
                    style="
                        width: 100%; 
                        height: 95vh; 
                        border: none;
                        display: block;
                    "
                ></iframe>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';
    
    // Add CSS animations if not already present
    if (!document.getElementById('apexModalStyles')) {
        const style = document.createElement('style');
        style.id = 'apexModalStyles';
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            /* Mobile responsive adjustments */
            @media (max-width: 768px) {
                #apexLoaderContainer {
                    padding: 1.5rem 1rem !important;
                    width: 95% !important;
                    margin: 0 auto;
                }
                
                #apexLoaderContainer h3 {
                    font-size: 1.2rem !important;
                }
                
                #apexLoaderContainer p {
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
                
                #apexReportContainer {
                    border-radius: 0 !important;
                    max-width: 100% !important;
                }
            }
            
            @media (max-width: 400px) {
                #apexLoaderContainer h3 {
                    font-size: 1rem !important;
                }
                
                #apexLoaderContainer p {
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
        'Report ready - preparing visualization...'
    ];
    
    let messageIndex = 0;
    const progressText = document.getElementById('aiProgressText');
    
    const progressInterval = setInterval(() => {
        if (messageIndex < progressMessages.length) {
            progressText.textContent = progressMessages[messageIndex];
            messageIndex++;
        } else {
            clearInterval(progressInterval);
        }
    }, 300); // Faster transitions (300ms each)
    
    // Store interval ID for cleanup
    window.aiProgressInterval = progressInterval;
    
    // Get iframe element
    const iframe = document.getElementById('apexReportIframe');
    const loaderContainer = document.getElementById('apexLoaderContainer');
    const reportContainer = document.getElementById('apexReportContainer');
    
    // Handle successful iframe load
    iframe.onload = () => {
        clearInterval(progressInterval);
        
        // Fade out loader with scale animation
        loaderContainer.style.opacity = '0';
        loaderContainer.style.transform = 'scale(0.9)';
        
        // After fade out, show report with beautiful entrance
        setTimeout(() => {
            loaderContainer.style.display = 'none';
            reportContainer.style.opacity = '1';
            reportContainer.style.transform = 'scale(1)';
            reportContainer.style.pointerEvents = 'auto';
        }, 500);
    };
    
    // Handle iframe load error (missing report) - keep spinner running
    iframe.onerror = () => {
        // Switch to "connecting" message and keep spinner active
        clearInterval(progressInterval);
        
        // Cycle through connecting messages indefinitely
        const connectingMessages = [
            'Connecting to APEX intelligence...',
            'Loading APEX engine...',
            'Fetching profile data...',
            'Preparing analysis...'
        ];
        
        let connectIndex = 0;
        window.aiProgressInterval = setInterval(() => {
            progressText.textContent = connectingMessages[connectIndex % connectingMessages.length];
            connectIndex++;
        }, 1000); // Change message every 1 second
    };
    
    // Fetch APEX JSON to get the score
    const jsonPath = `data/apex_reports/${ticker}_apex_profile.json`;
    fetch(jsonPath)
        .then(response => {
            if (!response.ok) throw new Error('JSON not found');
            return response.json();
        })
        .then(data => {
            // Extract APEX score from JSON
            const apexScore = data.top_card?.apex_score_100;
            const scoreDisplay = document.getElementById('apexScore');
            
            if (apexScore !== null && apexScore !== undefined) {
                scoreDisplay.textContent = apexScore;
                // Change color based on score
                if (apexScore >= 70) {
                    scoreDisplay.style.color = '#10b981'; // Green
                } else if (apexScore >= 50) {
                    scoreDisplay.style.color = '#f59e0b'; // Orange
                } else {
                    scoreDisplay.style.color = '#ef4444'; // Red
                }
            }
        })
        .catch(error => {
            // JSON not found - just show the icon
            const scoreDisplay = document.getElementById('apexScoreDisplay');
            scoreDisplay.innerHTML = '<span style="font-size: 1.3rem;">△</span>';
        });
}

function closeAIReportModal() {
    // Clear progress interval
    if (window.aiProgressInterval) {
        clearInterval(window.aiProgressInterval);
        window.aiProgressInterval = null;
    }
    
    const modal = document.getElementById('aiReportModal');
    if (modal) {
        // Add fade out animation
        modal.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 300);
    }
    
    // Add fadeOut keyframe if not present
    if (!document.getElementById('fadeOutAnimation')) {
        const style = document.createElement('style');
        style.id = 'fadeOutAnimation';
        style.textContent = `
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
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
    
    // Clone the table structure with just the VISIBLE header row
    const clonedTable = document.createElement('table');
    clonedTable.className = 'signals-table';
    const clonedThead = document.createElement('thead');
    
    // Find and clone only the visible header row
    const visibleHeaderRow = Array.from(originalThead.querySelectorAll('tr'))
        .find(row => row.style.display !== 'none');
    
    if (visibleHeaderRow) {
        clonedThead.appendChild(visibleHeaderRow.cloneNode(true));
    }
    
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
            // Use the actual table position for perfect alignment
            const tablePosition = originalTable.getBoundingClientRect();
            
            // On mobile, constrain to viewport width to prevent overflow
            if (isMobile) {
                const maxWidth = window.innerWidth - tablePosition.left;
                stickyContainer.style.width = Math.min(tablePosition.width, maxWidth) + 'px';
            } else {
                stickyContainer.style.width = tablePosition.width + 'px';
            }
            
            stickyContainer.style.left = tablePosition.left + 'px';
            stickyContainer.style.right = 'auto';
            
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

