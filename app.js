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

console.log('Global variables initialized');

// ============================================
// PENCE-AWARE HELPERS
// ============================================

// Return true if ticker appears to be an LSE ticker (.L)
function isLseTicker(ticker) {
    if (!ticker) return false;
    return String(ticker).toUpperCase().endsWith('.L');
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
    document.getElementById('latestScan').textContent = dashboardStats.latest_scan_date || '-';
    document.getElementById('lastUpdate').textContent = dashboardStats.generated || '-';
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
    
    // Apply sorting
    filteredSignals = sortSignals(filteredSignals);
    
    // Limit to latest 100 signals for performance
    const displaySignals = filteredSignals.slice(0, 100);
    console.log('Displaying:', displaySignals.length, 'signals');
    
    if (displaySignals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-results">No signals found matching your filters</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    
    displaySignals.forEach((signal, index) => {
        const metadata = allMetadata[signal.Ticker] || {};
        const tickerInfo = tickerLookup[signal.Ticker] || {};
        
        // Main row
        const tr = document.createElement('tr');
        tr.dataset.ticker = signal.Ticker;
        tr.dataset.index = index;
        tr.onclick = () => toggleExpandableRow(index);
        
        // Calculate current P&L from metadata
        const currentPnl = metadata.latest_signal?.current_pnl_pct || 0;
        const bestRally = metadata.best_rally_pct || 0;
        
        // Check for split warnings
        const splitRisk = metadata.split_risk || {};
        const hasSplit = splitRisk.split_detected || false;
        const splitWarningIcon = hasSplit ? `<span class="split-warning-icon" title="${splitRisk.warning || 'Split detected'} - ${splitRisk.recommendation || 'Verify data independently'}">⚠️</span>` : '';
        
        tr.innerHTML = `
            <td class="ticker-cell">
                ${signal.Ticker} ${splitWarningIcon}
                <span class="company-name">${tickerInfo.name || ''}</span>
            </td>
            <td>${signal.Date}</td>
            <td>${signal.Signal_Type}</td>
            <td><span class="signal-badge signal-${signal.Signal_Color}">${signal.Signal_Color}</span></td>
            <td>${parseFloat(signal.AI_Technical_Score).toFixed(1)}</td>
            <td class="negative">${parseFloat(signal.Drawdown_Pct).toFixed(1)}%</td>
            <td class="${currentPnl >= 0 ? 'positive' : 'negative'}">
                ${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%
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
                            <span class="metadata-label">Entry Price:</span>
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
                            <span class="metadata-label">Entry Price:</span>
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
                    
                    <!-- Split Risk Assessment (if detected) -->
                    ${metadata.split_risk?.split_detected ? `
                    <div class="metadata-section split-risk-section">
                        <h4>⚠️ Split Risk Assessment</h4>
                        <div class="split-risk-alert">
                            <div class="metadata-item">
                                <span class="metadata-label">Split Date:</span>
                                <span class="metadata-value">${metadata.split_risk.split_date}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Split Type:</span>
                                <span class="metadata-value">${metadata.split_risk.split_type} (${metadata.split_risk.split_description})</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Days From Split:</span>
                                <span class="metadata-value">${metadata.split_risk.days_from_split} days</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Risk Level:</span>
                                <span class="metadata-value risk-badge-${metadata.split_risk.risk_level.toLowerCase()}">${metadata.split_risk.risk_level}</span>
                            </div>
                            <div class="metadata-item">
                                <span class="metadata-label">Data Confidence:</span>
                                <span class="metadata-value">${metadata.split_risk.confidence}</span>
                            </div>
                            <div class="split-warning-box">
                                <strong>⚠️ Warning:</strong> ${metadata.split_risk.warning}
                            </div>
                            <div class="split-recommendation-box">
                                <strong>💡 Recommendation:</strong> ${metadata.split_risk.recommendation}
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
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
    const dateFilter = document.getElementById('dateFilter').value;
    
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
        const dateMatch = !dateFilter || signal.Date >= dateFilter;
        
        return searchMatch && colorMatch && sectorMatch && industryMatch && dateMatch;
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
                aVal = a.Signal_Type;
                bVal = b.Signal_Type;
                break;
            case 'signal_color':
                const colorOrder = { PURPLE: 5, RED: 4, ORANGE: 3, GREEN: 2, YELLOW: 1 };
                aVal = colorOrder[a.Signal_Color] || 0;
                bVal = colorOrder[b.Signal_Color] || 0;
                break;
            case 'ai_score':
                aVal = parseFloat(a.AI_Technical_Score) || 0;
                bVal = parseFloat(b.AI_Technical_Score) || 0;
                break;
            case 'drawdown':
                aVal = parseFloat(a.Drawdown_Pct) || 0;
                bVal = parseFloat(b.Drawdown_Pct) || 0;
                break;
            case 'current_pnl':
                aVal = allMetadata[a.Ticker]?.latest_signal?.current_pnl_pct || 0;
                bVal = allMetadata[b.Ticker]?.latest_signal?.current_pnl_pct || 0;
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
    ['colorFilter', 'sectorFilter', 'industryFilter', 'dateFilter'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                renderSignalsTable();
            });
        } else {
            console.error(`${id} element not found`);
        }
    });
    
    // Table sorting
    const sortableHeaders = document.querySelectorAll('.signals-table th.sortable');
    console.log('Found', sortableHeaders.length, 'sortable headers');
    sortableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const sortColumn = th.dataset.sort;
            
            // Toggle direction if same column
            if (currentSort.column === sortColumn) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = sortColumn;
                currentSort.direction = 'desc';
            }
            
            // Update UI
            document.querySelectorAll('.signals-table th').forEach(header => {
                header.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(`sort-${currentSort.direction}`);
            
            renderSignalsTable();
        });
    });
    
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
    document.getElementById('dateFilter').value = '';
    renderSignalsTable();
}

function formatMarketCap(marketCap) {
    if (!marketCap) return 'N/A';
    if (marketCap >= 1000000000) return `${(marketCap / 1000000000).toFixed(2)}B`;
    if (marketCap >= 1000000) return `${(marketCap / 1000000).toFixed(2)}M`;
    if (marketCap >= 1000) return `${(marketCap / 1000).toFixed(2)}K`;
    return `${marketCap}`;
}
