// Full Signal History Page - Display all signals with pagination
console.log('Full History page loaded');

let allSignals = [];
let allMetadata = {};
let filteredSignals = [];
let currentPage = 1;
const SIGNALS_PER_PAGE = 50;

// Load data on page load
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Loading data...');
    await loadAllData();
});

async function loadAllData() {
    try {
        const cacheBuster = '?v=' + Date.now();
        
        // Load metadata index
        console.log('Loading metadata...');
        const metadataResponse = await fetch('data/metadata_index.json' + cacheBuster);
        const metadataIndex = await metadataResponse.json();
        
        if (metadataIndex && metadataIndex.tickers) {
            metadataIndex.tickers.forEach(ticker => {
                if (ticker && ticker.ticker) {
                    allMetadata[ticker.ticker] = ticker;
                }
            });
            console.log('Metadata loaded for', Object.keys(allMetadata).length, 'tickers');
        }
        
        // Load signals CSV
        console.log('Loading signals...');
        Papa.parse('data/signals.csv' + cacheBuster, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                console.log('Signals loaded:', results.data.length, 'rows');
                allSignals = results.data.filter(row => row.Ticker);
                // Sort by date descending (latest first) by default
                allSignals.sort((a, b) => new Date(b.Date) - new Date(a.Date));
                filteredSignals = [...allSignals];
                currentSort = { key: 'date', direction: 'desc' };
                displayPage(1);
            },
            error: function(error) {
                console.error('Error loading signals:', error);
                document.getElementById('loadingState').innerHTML = '<p style="color: red;">Error loading signals</p>';
            }
        });
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('loadingState').innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
    }
}

function displayPage(page) {
    const tbody = document.getElementById('signalsTableBody');
    const loadingState = document.getElementById('loadingState');
    const emptyState = document.getElementById('emptyState');
    
    if (!tbody) {
        console.error('Table body not found');
        return;
    }
    
    // Hide loading
    if (loadingState) loadingState.style.display = 'none';
    
    // Check if empty
    if (filteredSignals.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    // Calculate pagination
    currentPage = page;
    const startIdx = (page - 1) * SIGNALS_PER_PAGE;
    const endIdx = startIdx + SIGNALS_PER_PAGE;
    const pageSignals = filteredSignals.slice(startIdx, endIdx);
    
    // Clear existing rows
    tbody.innerHTML = '';
    
    console.log(`Displaying page ${page}: signals ${startIdx + 1}-${Math.min(endIdx, filteredSignals.length)} of ${filteredSignals.length}`);
    
    // Display each signal
    pageSignals.forEach(signal => {
        const row = document.createElement('tr');
        
        const ticker = signal.Ticker;
        const signalDate = signal.Date;
        const signalType = signal.Signal_Type;
        const entryPrice = parseFloat(signal.Price);
        const aiScore = parseFloat(signal.AI_Technical_Score);
        
        // Get metadata for current price and best rally
        const metadata = allMetadata[ticker] || {};
        const currentPrice = metadata.current_price || entryPrice;
        const bestRallyPct = metadata.best_rally_pct || 0;
        
        // Calculate current P&L
        const currentPnl = ((currentPrice - entryPrice) / entryPrice) * 100;
        
        // Ticker
        const tickerCell = document.createElement('td');
        tickerCell.innerHTML = `<strong style="font-size: 0.95rem;">${ticker}</strong>`;
        row.appendChild(tickerCell);
        
        // Exchange
        const exchangeCell = document.createElement('td');
        const exchange = signal.Exchange || 'LSE';
        const market = signal.Market || 'AIM';
        const marketBadgeClass = exchange === 'AQUIS' ? 'aquis' : (market === 'MAIN' ? 'lse-main' : 'lse-aim');
        const marketBadgeText = exchange === 'AQUIS' ? 'AQUIS' : (market === 'MAIN' ? 'LSE' : 'LSE AIM');
        exchangeCell.innerHTML = `<span class="market-badge ${marketBadgeClass}" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">${marketBadgeText}</span>`;
        row.appendChild(exchangeCell);
        
        // Signal Date
        const dateCell = document.createElement('td');
        dateCell.textContent = signalDate;
        dateCell.style.fontSize = '0.85rem';
        row.appendChild(dateCell);
        
        // Signal Type with color badge
        const typeCell = document.createElement('td');
        
        // Parse signal type to check if enhanced and get base color
        const isEnhanced = signalType.toUpperCase().includes('ENHANCED');
        
        // Determine base crash color from signal type (not Signal_Color which is PURPLE for enhanced)
        let baseColor = 'YELLOW';
        const typeUpper = signalType.toUpperCase();
        if (typeUpper.includes('ULTRA')) {
            baseColor = 'RED';
        } else if (typeUpper.includes('EXTREME')) {
            baseColor = 'ORANGE';
        } else if (typeUpper.includes('DEEP')) {
            baseColor = 'GREEN';
        } else if (typeUpper.includes('CRASH ZONE') || typeUpper.includes('CRASH')) {
            baseColor = 'YELLOW';
        }
        
        const colorEmoji = {
            'RED': '🔴',
            'ORANGE': '🟠',
            'GREEN': '🟢',
            'YELLOW': '🟡'
        }[baseColor] || '🟡';
        
        // Create badge with enhanced ring if applicable
        const badgeContainer = document.createElement('span');
        badgeContainer.style.position = 'relative';
        badgeContainer.style.display = 'inline-block';
        badgeContainer.style.marginRight = '0.5rem';
        
        if (isEnhanced) {
            const enhancedRing = document.createElement('span');
            enhancedRing.className = 'enhanced-ring';
            enhancedRing.textContent = '🟣';
            enhancedRing.style.position = 'absolute';
            enhancedRing.style.fontSize = '1.5rem';
            enhancedRing.style.left = '50%';
            enhancedRing.style.top = '50%';
            enhancedRing.style.transform = 'translate(-50%, -50%)';
            enhancedRing.style.zIndex = '0';
            enhancedRing.style.animation = 'pulse-glow 2s ease-in-out infinite';
            badgeContainer.appendChild(enhancedRing);
        }
        
        const colorBadge = document.createElement('span');
        colorBadge.textContent = colorEmoji;
        colorBadge.style.fontSize = '1.1rem';
        colorBadge.style.position = 'relative';
        colorBadge.style.zIndex = '1';
        badgeContainer.appendChild(colorBadge);
        
        const typeText = document.createElement('span');
        typeText.textContent = signalType;
        typeText.style.fontSize = '0.8rem';
        typeText.style.fontWeight = '600';
        typeText.className = 'signal-type-text';
        
        typeCell.appendChild(badgeContainer);
        typeCell.appendChild(typeText);
        row.appendChild(typeCell);
        
        // Summary (Entry → Last, P&L)
        const summaryCell = document.createElement('td');
        summaryCell.innerHTML = `
            <div style="display: flex; gap: 0.5rem; align-items: center; font-size: 0.85rem;">
                <span style="color: #6B7280;">${entryPrice.toFixed(2)}p</span>
                <span style="color: #3B82F6;">→</span>
                <span style="color: #374151;">${currentPrice.toFixed(2)}p</span>
            </div>
            <div style="font-weight: 700; font-size: 0.9rem; margin-top: 2px; color: ${currentPnl >= 0 ? '#10B981' : '#EF4444'};">
                ${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(1)}%
            </div>
        `;
        row.appendChild(summaryCell);
        
        // AI Score
        const scoreCell = document.createElement('td');
        scoreCell.textContent = aiScore.toFixed(1);
        scoreCell.style.fontWeight = '700';
        scoreCell.style.fontSize = '0.95rem';
        if (aiScore >= 9) scoreCell.style.color = '#A855F7';
        else if (aiScore >= 7) scoreCell.style.color = '#3B82F6';
        else scoreCell.style.color = '#6B7280';
        row.appendChild(scoreCell);
        
        tbody.appendChild(row);
    });
    
    // Update pagination controls
    updatePaginationControls();
}

function updatePaginationControls() {
    const totalPages = Math.ceil(filteredSignals.length / SIGNALS_PER_PAGE);
    const wrapper = document.getElementById('signalsWrapper');
    
    // Remove existing pagination
    const existingPagination = document.getElementById('paginationControls');
    if (existingPagination) existingPagination.remove();
    
    if (totalPages <= 1) return;
    
    // Create pagination controls
    const pagination = document.createElement('div');
    pagination.id = 'paginationControls';
    pagination.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 2rem; padding: 1rem;';
    
    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Previous';
    prevBtn.style.cssText = 'padding: 0.5rem 1rem; background: #3B82F6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;';
    prevBtn.disabled = currentPage === 1;
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            displayPage(currentPage - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };
    
    // Page info
    const pageInfo = document.createElement('div');
    pageInfo.style.cssText = 'color: #374151; font-weight: 600;';
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${filteredSignals.length} signals)`;
    
    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.style.cssText = 'padding: 0.5rem 1rem; background: #3B82F6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;';
    nextBtn.disabled = currentPage === totalPages;
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentPage < totalPages) {
            displayPage(currentPage + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };
    
    pagination.appendChild(prevBtn);
    pagination.appendChild(pageInfo);
    pagination.appendChild(nextBtn);
    
    wrapper.parentNode.insertBefore(pagination, wrapper.nextSibling);
}

// Filter state
let activeFilters = {
    color: '',
    market: ''
};

// Search functionality
const searchInput = document.getElementById('searchInput');
if (searchInput) {
    searchInput.addEventListener('input', function(e) {
        applyFiltersAndSearch();
    });
}

// Filter modal functions
function openFiltersModal() {
    const modal = document.getElementById('filtersModal');
    if (modal) modal.style.display = 'flex';
}

function closeFiltersModal() {
    const modal = document.getElementById('filtersModal');
    if (modal) modal.style.display = 'none';
}

function resetFilters() {
    // Reset filter dropdowns
    document.getElementById('colorFilter').value = '';
    document.getElementById('marketFilter').value = '';
    
    // Reset state
    activeFilters = {
        color: '',
        market: ''
    };
    
    applyFiltersAndSearch();
}

function applyFilters() {
    // Get filter values
    activeFilters.color = document.getElementById('colorFilter').value;
    activeFilters.market = document.getElementById('marketFilter').value;
    
    closeFiltersModal();
    applyFiltersAndSearch();
}

function applyFiltersAndSearch() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    
    filteredSignals = allSignals.filter(signal => {
        // Search filter
        const matchesSearch = searchTerm === '' || 
            (signal.Ticker || '').toLowerCase().includes(searchTerm) ||
            (signal.Signal_Type || '').toLowerCase().includes(searchTerm);
        
        if (!matchesSearch) return false;
        
        // Color filter
        if (activeFilters.color && signal.Signal_Color !== activeFilters.color) {
            return false;
        }
        
        // Market filter
        if (activeFilters.market) {
            const exchange = signal.Exchange || 'LSE';
            const market = signal.Market || 'AIM';
            const signalMarket = `${exchange}-${market}`;
            if (signalMarket !== activeFilters.market) {
                return false;
            }
        }
        
        return true;
    });
    
    displayPage(1);
}

// Column sorting
document.querySelectorAll('.sortable').forEach(header => {
    header.addEventListener('click', function() {
        const sortKey = this.dataset.sort;
        sortSignals(sortKey);
    });
});

let currentSort = { key: null, direction: 'desc' };

function sortSignals(key) {
    // Toggle direction if clicking same column
    if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.direction = 'desc';
    }
    
    const direction = currentSort.direction === 'asc' ? 1 : -1;
    
    filteredSignals.sort((a, b) => {
        let aVal, bVal;
        
        switch(key) {
            case 'ticker':
                aVal = a.Ticker || '';
                bVal = b.Ticker || '';
                return direction * aVal.localeCompare(bVal);
            
            case 'exchange':
                aVal = (a.Exchange || 'LSE') + ' ' + (a.Market || 'AIM');
                bVal = (b.Exchange || 'LSE') + ' ' + (b.Market || 'AIM');
                return direction * aVal.localeCompare(bVal);
            
            case 'date':
                aVal = new Date(a.Date);
                bVal = new Date(b.Date);
                return direction * (aVal - bVal);
            
            case 'signal_type':
                aVal = a.Signal_Type || '';
                bVal = b.Signal_Type || '';
                return direction * aVal.localeCompare(bVal);
            
            case 'current_pnl':
                const metaA = allMetadata[a.Ticker] || {};
                const metaB = allMetadata[b.Ticker] || {};
                const priceA = parseFloat(a.Price);
                const priceB = parseFloat(b.Price);
                const currentA = metaA.current_price || priceA;
                const currentB = metaB.current_price || priceB;
                aVal = ((currentA - priceA) / priceA) * 100;
                bVal = ((currentB - priceB) / priceB) * 100;
                return direction * (aVal - bVal);
            
            case 'ai_score':
                aVal = parseFloat(a.AI_Technical_Score) || 0;
                bVal = parseFloat(b.AI_Technical_Score) || 0;
                return direction * (aVal - bVal);
            
            default:
                return 0;
        }
    });
    
    displayPage(currentPage);
}
