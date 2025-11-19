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
let dateFilter = 'all'; // 'all', '1m', '3m', '6m', '1y', 'custom'
let customDateRange = { start: null, end: null };
let viewMode = localStorage.getItem('viewMode') || 'compressed'; // 'compressed' or 'full'
let groupedSignals = {}; // Grouped by ticker for compressed mode
let expandedTickers = new Set(); // Track which tickers are expanded

console.log('Global variables initialized');

// ============================================
// PENCE-AWARE HELPERS
// ============================================

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
        populateFilterDropdowns(lookupData.sectors, lookupData.industries);
        
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
        
        // Load signals CSV
        console.log('Loading signals CSV...');
        console.log('About to call Papa.parse...');
        Papa.parse('data/signals.csv' + cacheBuster, {
            download: true,
            header: true,
            complete: (results) => {
                console.log('Signals CSV loaded:', results.data.length, 'rows');
                allSignals = results.data.filter(row => row.Ticker); // Remove empty rows
                console.log('Filtered signals:', allSignals.length);
                renderSignalsTable();
            },
            error: (error) => {
                console.error('Error loading signals CSV:', error);
                document.getElementById('signalsTableBody').innerHTML = 
                    '<tr><td colspan="8" class="no-results">Error loading signals data</td></tr>';
            }
        });
        console.log('Papa.parse called (async, will complete later)');
        
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
        const time = parts.slice(1).join(' '); // "23:32:29 UTC"
        document.getElementById('lastUpdate').innerHTML = `<span class="date">${date}</span><span class="time">${time}</span>`;
    } else {
        document.getElementById('lastUpdate').textContent = '-';
    }
}

// ============================================
// POPULATE FILTER DROPDOWNS
// ============================================

function populateFilterDropdowns(sectors, industries) {
    const sectorSelect = document.getElementById('sectorFilter');
    const industrySelect = document.getElementById('industryFilter');
    
    sectors.forEach(sector => {
        const option = document.createElement('option');
        option.value = sector;
        option.textContent = sector;
        sectorSelect.appendChild(option);
    });
    
    industries.forEach(industry => {
        const option = document.createElement('option');
        option.value = industry;
        option.textContent = industry;
        industrySelect.appendChild(option);
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
    const compactLabel = document.getElementById('compactLabel');
    const detailLabel = document.getElementById('detailLabel');
    const hint = document.getElementById('viewModeHint');
    const fullHeader = document.getElementById('tableHeader');
    const compressedHeader = document.getElementById('compressedHeader');
    
    if (!slider || !compactLabel || !detailLabel || !hint || !fullHeader || !compressedHeader) {
        console.warn('View mode UI elements not found, skipping update');
        return;
    }
    
    if (viewMode === 'compressed') {
        slider.classList.remove('active');
        compactLabel.classList.add('active');
        detailLabel.classList.remove('active');
        hint.textContent = 'Compact view shows one row per ticker. Click ticker to expand history.';
        fullHeader.style.display = 'none';
        compressedHeader.style.display = '';
    } else {
        slider.classList.add('active');
        compactLabel.classList.remove('active');
        detailLabel.classList.add('active');
        hint.textContent = 'Detail view shows all signals individually.';
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
        
        // Best score across all signals
        const bestScore = Math.max(...[latest, ...group.history].map(s => parseFloat(s.AI_Technical_Score)));
        
        // Best rally from metadata
        const bestRally = metadata.best_rally_pct || 0;
        
        // Parent row
        const parentRow = document.createElement('tr');
        parentRow.className = 'ticker-parent-row';
        if (expandedTickers.has(ticker)) {
            parentRow.classList.add('expanded');
        }
        parentRow.dataset.ticker = ticker;
        parentRow.onclick = () => toggleTickerExpansion(ticker);
        
        const expandIcon = expandedTickers.has(ticker) ? '▼' : '▶';
        
        // Create signal badges (up to 4, then +N more) from ALL signals (latest + history)
        const allTickerSignals = [latest, ...group.history];
        const signalBadges = allTickerSignals.slice(0, 4).map(sig => {
            const colorEmoji = {
                'PURPLE': '🟣',
                'RED': '🔴',
                'ORANGE': '🟠',
                'GREEN': '🟢',
                'YELLOW': '🟡'
            }[sig.Signal_Color] || '';
            return `<span class="signal-badge signal-${sig.Signal_Color}" title="${sig.Signal_Type}">${colorEmoji}</span>`;
        }).join(' ');
        
        const remaining = group.count > 4 ? `<span class="more-signals">+${group.count - 4}</span>` : '';
        
        parentRow.innerHTML = `
            <td class="ticker-cell">
                <span class="expand-indicator">${expandIcon}</span>
                ${cleanTickerDisplay(ticker)}
                <span class="company-name">${tickerInfo.name || ''}</span>
            </td>
            <td style="white-space: nowrap;">${signalBadges}${remaining}</td>
            <td>${latest.Date}</td>
            <td>${bestScore.toFixed(1)}</td>
            <td>
                <div style="font-size: 0.8rem; color: var(--gray); line-height: 1.3;">${triggerPrice.toFixed(2)}p</div>
                <div class="${currentPnl >= 0 ? 'positive' : 'negative'}" style="font-weight: 700; font-size: 0.95rem; line-height: 1.4;">
                    ${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%
                </div>
                <div style="font-size: 0.75rem; margin-top: 2px;">
                    <span style="color: var(--gray); opacity: 0.7;">Best rally</span>
                    <span style="color: var(--rally-green); font-weight: 600; margin-left: 4px;">${bestRally.toFixed(0)}%</span>
                </div>
            </td>
        `;
        
        tbody.appendChild(parentRow);
        
        // History rows (hidden by default)
        // Sort all signals (latest + history) by current sort direction
        const allSignals = [latest, ...group.history];
        const sortedHistory = allSignals.sort((a, b) => {
            const dateA = new Date(a.Date);
            const dateB = new Date(b.Date);
            // Always sort history by date, respecting current direction
            return currentSort.direction === 'desc' ? dateB - dateA : dateA - dateB;
        });
        
        sortedHistory.forEach((signal, idx) => {
            const historyRow = createHistoryRow(signal, metadata, tickerInfo, ticker);
            tbody.appendChild(historyRow);
        });
            } catch (error) {
                console.error('Error rendering ticker:', ticker, error);
            }
        });
    } catch (error) {
        console.error('Error in compressed mode rendering:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="no-results">Error loading signals</td></tr>';
    }
}

function createHistoryRow(signal, metadata, tickerInfo, ticker) {
    const tr = document.createElement('tr');
    tr.className = 'ticker-history-row';
    tr.dataset.ticker = ticker;
    if (expandedTickers.has(ticker)) {
        tr.classList.add('visible');
    }
    tr.onclick = () => toggleExpandableRow(signal, metadata, tickerInfo);
    
    const triggerPrice = parseFloat(signal.Price);
    const currentPrice = metadata.current_price || triggerPrice;
    const currentPnl = ((currentPrice - triggerPrice) / triggerPrice) * 100;
    const bestRally = metadata.best_rally_pct || 0;
    
    let shortSignalType = signal.Signal_Type
        .replace('EXTREME CRASH BOTTOM', 'Extreme')
        .replace('ULTRA CRASH BOTTOM', 'Ultra')
        .replace('DEEP CRASH BOTTOM', 'Deep')
        .replace('CRASH ZONE BOTTOM', 'Crash')
        .replace('ACCUMULATION ZONE', 'Accumulation')
        .replace('PRE-ACCUMULATION', 'Pre-Accum');
    
    if (shortSignalType.includes('COMBO')) {
        shortSignalType = shortSignalType
            .replace(/ENHANCED.*COMBO/i, 'Combo')
            .replace(/CRASH.*COMBO/i, 'Combo')
            .replace(/COMBO/i, 'Combo');
    }
    
    const colorEmoji = {
        'PURPLE': '🟣',
        'RED': '🔴',
        'ORANGE': '🟠',
        'GREEN': '🟢',
        'YELLOW': '🟡'
    }[signal.Signal_Color] || '';
    
    const drawdownPct = parseFloat(signal.Drawdown_Pct) || 0;
    
    tr.innerHTML = `
        <td style="padding-left: 2rem;">→ ${cleanTickerDisplay(ticker)}</td>
        <td>
            <span class="signal-badge signal-${signal.Signal_Color}">${colorEmoji} ${shortSignalType} (${drawdownPct.toFixed(0)}%)</span>
        </td>
        <td>${signal.Date}</td>
        <td>${parseFloat(signal.AI_Technical_Score).toFixed(1)}</td>
        <td>
            <div style="font-size: 0.85rem; color: var(--gray); margin-bottom: 2px;">${triggerPrice.toFixed(2)}p</div>
            <div class="${currentPnl >= 0 ? 'positive' : 'negative'}" style="font-weight: 600;">
                ${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%
            </div>
        </td>
    `;
    
    return tr;
}

function toggleTickerExpansion(ticker) {
    if (expandedTickers.has(ticker)) {
        expandedTickers.delete(ticker);
    } else {
        expandedTickers.add(ticker);
    }
    
    // Update UI
    const parentRow = document.querySelector(`tr.ticker-parent-row[data-ticker="${ticker}"]`);
    const historyRows = document.querySelectorAll(`tr.ticker-history-row[data-ticker="${ticker}"]`);
    const indicator = parentRow?.querySelector('.expand-indicator');
    
    if (expandedTickers.has(ticker)) {
        parentRow?.classList.add('expanded');
        historyRows.forEach(row => row.classList.add('visible'));
        if (indicator) indicator.textContent = '▼';
    } else {
        parentRow?.classList.remove('expanded');
        historyRows.forEach(row => row.classList.remove('visible'));
        if (indicator) indicator.textContent = '▶';
    }
}

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
        
        // Clean up signal type text - handle all combo variations
        let shortSignalType = signal.Signal_Type
            .replace('CRASH ZONE BOTTOM', 'Crash Zone')
            .replace('EXTREME CRASH BOTTOM', 'Extreme Crash')
            .replace('ULTRA CRASH BOTTOM', 'Ultra Crash')
            .replace('DEEP CRASH BOTTOM', 'Deep Crash')
            .replace('ACCUMULATION ZONE', 'Accumulation')
            .replace('PRE-ACCUMULATION', 'Pre-Accumulation');
        
        // Handle all combo variations (do this AFTER basic replacements)
        if (shortSignalType.includes('COMBO')) {
            shortSignalType = shortSignalType
                .replace(/ENHANCED.*COMBO/i, 'Enhanced Combo')
                .replace(/CRASH.*COMBO/i, 'Crash Combo')
                .replace(/COMBO/i, 'Combo');
        }
        
        const drawdown = parseFloat(signal.Drawdown_Pct).toFixed(0);
        
        tr.innerHTML = `
            <td class="ticker-cell">
                ${cleanTickerDisplay(signal.Ticker)} ${splitWarningIcon}
                <span class="company-name">${tickerInfo.name || ''}</span>
            </td>
            <td>${signal.Date}</td>
            <td>
                <span class="signal-badge signal-${signal.Signal_Color}">
                    ${shortSignalType} (${drawdown}%)
                </span>
            </td>
            <td>${parseFloat(signal.AI_Technical_Score).toFixed(1)}</td>
            <td class="price-pnl-cell">
                <div class="price-pnl-container">
                    <span class="trigger-price">${parseFloat(signal.Price).toFixed(2)}p</span>
                    <span class="pnl-badge ${currentPnl >= 0 ? 'positive' : 'negative'}">
                        ${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%
                    </span>
                </div>
            </td>
            <td class="positive">+${bestRally.toFixed(1)}%</td>
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
    const athVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, basics, 'ath');
    const atlVal = getPriceFieldForTicker(signal?.Ticker || lseTicker, basics, 'atl');
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
                            <span class="metadata-label">All-Time High:</span>
                            <span class="metadata-value">${fmtPrice(athVal)}p (${basics.ath_date || '-'})</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">All-Time Low:</span>
                            <span class="metadata-value">${fmtPrice(atlVal)}p (${basics.atl_date || '-'})</span>
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
    const industryFilter = document.getElementById('industryFilter').value;
    
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
        
        // Industry filter
        const industryMatch = !industryFilter || tickerInfo.industry === industryFilter;
        
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
        
        return hasValidData && searchMatch && colorMatch && sectorMatch && industryMatch && dateMatch;
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
    ['colorFilter', 'sectorFilter', 'industryFilter'].forEach(id => {
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
                    'signal_count': 'ticker'
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
    document.getElementById('industryFilter').value = '';
    
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
