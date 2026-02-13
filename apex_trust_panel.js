// Prototype loader that accepts an inlined profile (`window.__APEX_PROFILE`) or
// falls back to fetching the profile JSON. Maps the generator schema into the
// prototype shape and renders the UI.

async function load(){
try{
// Check if data is inlined (for backwards compatibility)
if(typeof window.__APEX_PROFILE !== 'undefined' && Object.keys(window.__APEX_PROFILE).length > 0){
render(mapProfile(window.__APEX_PROFILE));
return;
}

// Get ticker from URL query parameter (?ticker=PXC.L)
const params = new URLSearchParams(window.location.search);
const ticker = params.get('ticker');

if(!ticker){
throw new Error('No ticker specified. Use ?ticker=PXC.L in URL');
}

// Fetch the ticker's JSON profile from /data/apex_reports/{ticker}_apex_profile.json
const url = `/data/apex_reports/${ticker}_apex_profile.json`;
console.log(`Loading profile for ${ticker} from ${url}`);
const r = await fetch(url);

if(!r.ok){
throw new Error(`Failed to fetch ${url}: ${r.status} ${r.statusText}`);
}

const raw = await r.json();
window.__APEX_PROFILE = raw;  // Set global for populate functions
render(mapProfile(raw));
}catch(err){
console.error('Load error:',err);
renderError(err);
}
}
function pct(v){return Math.max(0,Math.min(100,Math.round(v)))}

function mapProfile(p){
	const composite_score = (p.top_card && p.top_card.apex_score_100) || (p.comprehensive_apex && p.comprehensive_apex.score) || 0;
	const composite_label = (p.top_card && p.top_card.apex_rating) || (p.comprehensive_apex && p.comprehensive_apex.rating) || '';
	const compObj = (p.comprehensive_apex && p.comprehensive_apex.components) || {};
	const components = ['setup','trust','panic','compression'].map(k=>{
		const raw = compObj[k] || {};
		return {
			name: k.charAt(0).toUpperCase() + k.slice(1),
			score: raw.score != null ? raw.score : ((p.top_card && p.top_card[`${k}_score_100`]) || 0),
			weight: raw.weight || 0,
			percentile: raw.percentile || Math.round(raw.score||0),
			std: raw.std || 2.5,
			sparkline: Array(5).fill(raw.score != null ? raw.score : 0)
		};
	});
	
	// Calculate real coverage from actual data sources
	const rnsCount = (p.enrichment && p.enrichment.all_historical_signals && p.enrichment.all_historical_signals.length) || 0;
	const socialCount = (p.triangulation && p.triangulation.social && p.triangulation.social.post_count) || 0;
	const trendsExists = (p.triangulation && p.triangulation.trends && p.triangulation.trends.intelligence_signal) ? 1 : 0;
	const priceHistoryBars = (p.enrichment && p.enrichment.basics && p.enrichment.basics.total_bars) || 0;
	const socialBuzz = (p.triangulation && p.triangulation.social && p.triangulation.social.buzz_level) || 'NONE';
	
	// Calculate coverage percentages based on data availability
	const rnsNormalized = Math.min(100, (rnsCount / 50) * 100); // 50 RNS = 100% coverage
	const socialNormalized = Math.min(100, (socialCount / 1000) * 100); // 1000 posts = 100% coverage
	const trendsNormalized = trendsExists * 100;
	const historyNormalized = Math.min(100, (priceHistoryBars / 1000) * 100); // 1000 bars = 100% coverage
	
	const trust = {
		score: (p.top_card && p.top_card.confidence_score_100) || 0,
		coverage: {
			RNS: {freshness: rnsCount > 0 ? 'Current' : 'No data', coverage: rnsNormalized, reliability: rnsCount > 10 ? 0.95 : rnsCount > 0 ? 0.7 : 0},
			Social: {freshness: socialCount > 0 ? 'Live' : 'No data', coverage: socialNormalized, reliability: socialCount > 100 ? 0.85 : socialCount > 0 ? 0.6 : 0},
			Trends: {freshness: trendsExists ? 'Active' : 'N/A', coverage: trendsNormalized, reliability: trendsExists ? 0.75 : 0},
			History: {freshness: priceHistoryBars > 0 ? 'Complete' : 'No data', coverage: historyNormalized, reliability: priceHistoryBars > 500 ? 0.95 : priceHistoryBars > 0 ? 0.7 : 0}
		},
		sample_size: priceHistoryBars,
		std_error: (p.enrichment && p.enrichment.std_error) || 0,
		ci_low: (p.top_card && p.top_card.confidence_score_100) ? Math.max(0, (p.top_card.confidence_score_100 - 8)) : 0,
		ci_high: (p.top_card && p.top_card.confidence_score_100) ? Math.min(100, (p.top_card.confidence_score_100 + 8)) : 0,
		trajectory: (p.enrichment && p.enrichment.trust && p.enrichment.trust.trajectory) || [],
		dataQuality: (p.enrichment && p.enrichment.data_quality) || {}
	};
	// best-effort extraction of per-component detailed metrics
	const extra = {};
	try{
		extra.setup = {
			ai_technical_score: (p.scoring_breakdown && p.scoring_breakdown.technical_score && p.scoring_breakdown.technical_score.ai_score) || (p.top_card && p.top_card.ai_final_score_25) || 0,
			drawdown_pct: (p.enrichment && p.enrichment.basics && p.enrichment.basics.drawdown_from_ath_pct) || 0,
			relative_volume: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.volume_death && p.crashdash.contrarian_panic.components.volume_death.relative_volume) || 0,
			rally_count: (p.enrichment && p.enrichment.stats && p.enrichment.stats.total_signals) || 0,
			best_historical_rally: (p.enrichment && p.enrichment.stats && p.enrichment.stats.best_rally_pct) || 0,
			penalties: (p.split_risk && p.split_risk.split_detected) ? ['SPLIT_RISK'] : []
		};
		extra.panic = {
			price_destruction: (p.crashdash && p.crashdash.panic_analysis && p.crashdash.panic_analysis.breakdown && p.crashdash.panic_analysis.breakdown.price_destruction) || 0,
			volume_death: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.volume_death && p.crashdash.contrarian_panic.components.volume_death.relative_volume) || 0,
			social_silence: (p.crashdash && p.crashdash.panic_analysis && p.crashdash.panic_analysis.breakdown && p.crashdash.panic_analysis.breakdown.social_silence) || 0,
			news_sentiment: (p.crashdash && p.crashdash.panic_analysis && p.crashdash.panic_analysis.breakdown && p.crashdash.panic_analysis.breakdown.news_sentiment) || 0,
			crash_signal: (p.crashdash && p.crashdash.crashhunter_signals && p.crashdash.crashhunter_signals[0] && p.crashdash.crashhunter_signals[0].text) || ''
		};
		extra.compression = {
			signals_per_week: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.compression && p.crashdash.contrarian_panic.components.compression.signals_per_week) || 0,
			rsi_extreme_count: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.compression && p.crashdash.contrarian_panic.components.compression.rsi_extreme_count) || 0,
			escalation_events: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.compression && p.crashdash.contrarian_panic.components.compression.escalation_count) || 0,
			intensification_score: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.intensification && p.crashdash.contrarian_panic.components.intensification.score) || 0,
			intensification_pattern: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.intensification && p.crashdash.contrarian_panic.components.intensification.pattern) || '',
			pop_potential: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.compression && p.crashdash.contrarian_panic.components.compression.best_historical_rally) || (p.enrichment && p.enrichment.stats && p.enrichment.stats.best_rally_pct) || 0,
			volume_death_score: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.volume_death && p.crashdash.contrarian_panic.components.volume_death.score) || 0,
			volume_death_desc: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.volume_death && p.crashdash.contrarian_panic.components.volume_death.description) || '',
			accumulation_score: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.accumulation && p.crashdash.contrarian_panic.components.accumulation.score) || 0,
			accumulation_desc: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.components && p.crashdash.contrarian_panic.components.accumulation && p.crashdash.contrarian_panic.components.accumulation.description) || '',
			congestion_band: (p.crashdash && p.crashdash.contrarian_panic && p.crashdash.contrarian_panic.band) || 'MOD'
		};
	}catch(e){console.warn('extra mapping failed',e)}
	return {composite_score,composite_label,components,trust,extra};
}

function populateStockHeader(profile) {
	try {
		const enrichment = profile.enrichment || {};
		const companyInfo = enrichment.company_info || {};
		const basics = enrichment.basics || {};
		
		// Ticker
		const ticker = profile.top_card?.ticker || profile.symbol || '--';
		document.getElementById('header-ticker').textContent = ticker;
		
		// Company name
		const companyName = companyInfo.name || '--';
		document.getElementById('header-company').textContent = companyName;
		
		// Currency
		const currency = (companyInfo.currency || 'GBP').toUpperCase();
		document.getElementById('header-currency').textContent = currency;
		
		// Price
		const price = basics.current_price || companyInfo.current_close_price || 0;
		const priceFormatted = price < 1 ? price.toFixed(4) + 'p' : price.toFixed(2);
		document.getElementById('header-price').textContent = priceFormatted;
		
		// Market Cap
		const mcap = companyInfo.current_market_cap || companyInfo.market_cap_gbp || 0;
		const mcapFormatted = mcap >= 1e9 ? (mcap / 1e9).toFixed(2) + 'B' :
		                       mcap >= 1e6 ? (mcap / 1e6).toFixed(2) + 'M' :
		                       mcap >= 1e3 ? (mcap / 1e3).toFixed(2) + 'K' : mcap.toFixed(0);
		document.getElementById('header-mcap').textContent = mcapFormatted;
		
		// Exchange
		const exchange = companyInfo.exchange || 'LSE';
		const market = companyInfo.market || '';
		const exchangeHTML = market ? 
			`<span style="color: #06b6d4;">${exchange}</span><span style="color: #a855f7;"> ${market}</span>` :
			`<span style="color: #06b6d4;">${exchange}</span>`;
		document.getElementById('header-exchange').innerHTML = exchangeHTML;
		
		// Sector
		const sector = companyInfo.sector || '--';
		document.getElementById('header-sector').textContent = sector;
		
		// Industry
		const industry = companyInfo.industry || '--';
		document.getElementById('header-industry').textContent = industry;
	} catch(e) {
		console.error('populateStockHeader failed', e);
	}
}

function populateScorecard(profile) {
	try {
		const apex = profile.comprehensive_apex || {};
		const components = apex.components || {};
		const topCard = profile.top_card || {};
		
		// APEX Score (overall composite score)
		document.getElementById('scorecard-apex').textContent = `APEX SCORE:${apex.score || '--'}`;
		
		// Setup Score
		document.getElementById('scorecard-setup').textContent = `SETUP:${components.setup?.score || '--'}`;
		
		// Trust Score
		document.getElementById('scorecard-trust').textContent = `TRUST:${components.trust?.score || '--'}`;
		
		// Panic Score
		document.getElementById('scorecard-panic').textContent = `PANIC:${components.panic?.score || '--'}`;
		
		// Compression Score
		document.getElementById('scorecard-comp').textContent = `COMPRESSION:${components.compression?.score || '--'}`;
		
		// Timing Regime
		const timing = topCard.timing_regime || apex.timing?.regime || 'UNKNOWN';
		document.getElementById('scorecard-timing').textContent = `TIMING:${timing}`;
		
		// Action
		const action = topCard.action || 'WATCH';
		document.getElementById('scorecard-action').textContent = `ACTION:${action}`;
		
		// Clone ticker content for seamless animation loop
		const ticker = document.getElementById('scorecard-ticker');
		const content = ticker.querySelector('.ticker-content');
		if(content && !ticker.querySelector('.ticker-content:nth-child(2)')) {
			const clone = content.cloneNode(true);
			ticker.appendChild(clone);
		}
	} catch(e) {
		console.error('populateScorecard failed', e);
	}
}

function createBloombergProgressBar(score, color = '#10b981') {
	// Create Bloomberg-style progress bar: █████████░░░░░░░░░░░░
	const totalBlocks = 40;
	const filledBlocks = Math.round((score / 100) * totalBlocks);
	const emptyBlocks = totalBlocks - filledBlocks;
	
	const filled = '█'.repeat(filledBlocks);
	const empty = '░'.repeat(emptyBlocks);
	
	return `<div style="font-family: 'Courier New', monospace; letter-spacing: -1px; font-size: 11px; color: ${color};">${filled}<span style="color: rgba(255,255,255,0.2);">${empty}</span></div>`;
}

function getHeatMapColor(score) {
	// Heat map gradient based on score value (0-100)
	// Red (0-33) → Yellow (34-66) → Green (67-100)
	if (score < 0) score = 0;
	if (score > 100) score = 100;
	
	if (score <= 33) {
		// Red zone: #EF4444 (0) to #FCD34D (33)
		const ratio = score / 33;
		return `hsl(0, 100%, ${50 + ratio * 10}%)`; // Red to yellow-red
	} else if (score <= 66) {
		// Yellow zone: #FCD34D (34) to #FBBF24 (66)
		return '#FCD34D'; // Amber/Yellow
	} else {
		// Green zone: #FBBF24 (67) to #10B981 (100)
		const ratio = (score - 66) / 34;
		return `hsl(${120 * ratio}, 100%, ${50 - ratio * 5}%)`; // Yellow to green
	}
}

function createRiskAuditCard(data, idx) {
	const card = document.createElement('div');
	card.className = 'card component-card stack-card';
	card.dataset.index = idx;
	
	const profile = window.__APEX_PROFILE || {};
	const enrichment = profile.enrichment || {};
	const splitRisk = enrichment.split_risk || {};
	const riskFlags = enrichment.risk_flags || [];
	const companyInfo = enrichment.company_info || {};
	const mcap = companyInfo.current_market_cap || companyInfo.market_cap_gbp || 0;
	
	// Risk assessments
	const splitLevel = splitRisk.risk_level || 'NONE';
	const splitColor = splitLevel === 'NONE' ? '#10b981' : splitLevel === 'LOW' ? '#f59e0b' : '#ef4444';
	
	const pennyStock = mcap < 5000000;
	const pennyColor = pennyStock ? '#ef4444' : '#10b981';
	
	const hasRisks = riskFlags.length > 0;
	const riskColor = hasRisks ? '#f59e0b' : '#10b981';
	
	card.innerHTML = `
		<div class="panel-header" style="padding:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
			<div style="font-size:16px;font-weight:800">⚠️ Risk Audit <span style="cursor:help;opacity:0.6;font-size:14px" title="Structural risk checks for trading safety">\u24d8</span></div>
			<div style="margin-top:8px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.5);">BLOOMBERG RISK MATRIX</div>
		</div>
		<div class="component-row-breakdown" style="padding:8px">
			<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
				<!-- Split Risk -->
				<div style="padding:8px;background:rgba(31,41,55,0.3);border-radius:4px;border-left:3px solid ${splitColor}">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
						<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px;">Split Risk</div>
						<div style="font-size:12px;font-weight:800;color:${splitColor};">${splitLevel}</div>
					</div>
					<div style="font-size:10px;color:#d1d5db;line-height:1.4;">${splitRisk.confidence || 'No splits'}</div>
				</div>
				
				<!-- Penny Stock -->
				<div style="padding:8px;background:rgba(31,41,55,0.3);border-radius:4px;border-left:3px solid ${pennyColor}">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
						<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px;">Penny Stock</div>
						<div style="font-size:12px;font-weight:800;color:${pennyColor};">${pennyStock ? 'YES' : 'NO'}</div>
					</div>
					<div style="font-size:10px;color:#d1d5db;line-height:1.4;">${pennyStock ? '<£5m cap' : '≥£5m cap'}</div>
				</div>
				
				<!-- Active Risk Flags -->
				<div style="padding:8px;background:rgba(31,41,55,0.3);border-radius:4px;border-left:3px solid ${riskColor}">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
						<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px;">Flags</div>
						<div style="font-size:12px;font-weight:800;color:${riskColor};">${riskFlags.length}</div>
					</div>
					<div style="font-size:9px;color:#d1d5db;line-height:1.3;">
						${hasRisks ? riskFlags.slice(0,2).map(flag => `• ${flag.substring(0,10)}`).join('<br>') : 'No risks'}
					</div>
				</div>
				
				<!-- Data Quality -->
				<div style="padding:8px;background:rgba(31,41,55,0.3);border-radius:4px;border-left:3px solid #06b6d4">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
						<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px;">Data</div>
						<div style="font-size:12px;font-weight:800;color:#06b6d4;">${enrichment.data_quality?.overall_confidence || 'HIGH'}</div>
					</div>
					<div style="font-size:9px;color:#d1d5db;line-height:1.3;">
						Price: OK
					</div>
				</div>
			</div>
			
			<div style="margin-top:8px;padding:8px;background:rgba(59,130,246,0.1);border-radius:4px;border:1px solid rgba(59,130,246,0.3);">
				<div style="font-size:10px;font-weight:700;color:#3b82f6;margin-bottom:4px;">RISK MATRIX</div>
				<div style="font-size:10px;color:#d1d5db;line-height:1.5;">
					${pennyStock ? '⚠️ Micro-cap volatility. ' : ''}
					${hasRisks ? '⚠️ Monitor flags. ' : '✓ No concerns. '}
					Verify data before positioning.
				</div>
			</div>
		</div>
	`;
	
	return card;
}

// Populate Company in 30 Seconds
function populateCompany30Sec(profile) {
	const aiInsights = profile.ai_insights || {};
	const company30s = aiInsights.company_30s || {};
	
	// Use AI-generated content from profile
	const whatTheyDo = company30s.what_they_do || 'No description available';
	const whyTheyMatter = company30s.why_they_matter || 'Limited market visibility';
	const currentState = company30s.current_state || 'Monitoring for developments';
	
	// Populate elements
	document.getElementById('company-what').textContent = whatTheyDo;
	document.getElementById('company-why').textContent = whyTheyMatter;
	document.getElementById('company-state').textContent = currentState;
}

// Toggle collapsible sections
function toggleSection(sectionId) {
	const content = document.getElementById(sectionId + '-content');
	const arrow = document.getElementById(sectionId + '-arrow');
	
	if (content.style.display === 'none') {
		content.style.display = 'block';
		arrow.textContent = '▼';
		arrow.style.transform = 'rotate(0deg)';
	} else {
		content.style.display = 'none';
		arrow.textContent = '▶';
		arrow.style.transform = 'rotate(0deg)';
	}
}

// Populate Bloomberg Phase 2 sections
function populateBloombergSections(profile) {
	populateCrashDashIntelligence(profile);
	populateCatalystPipeline(profile);
	populateMarketTape(profile);
	populateInvestmentDecision(profile);
	populateRNSAnnouncements(profile);
}

function populateCrashDashIntelligence(profile) {
	const container = document.getElementById('crashdash-data');
	const crashdash = profile.crashdash || {};
	const intelligence = crashdash.industry_intelligence || {};
	const patterns = intelligence.active_patterns || [];
	const recoveryPaths = intelligence.recovery_paths || [];
	
	let html = `
		<div style="margin-bottom: 16px;">
			<div style="color: #3b82f6; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">INDUSTRY: ${intelligence.name || 'SOFTWARE & HARDWARE'}</div>
			<div style="color: #d1d5db; margin-bottom: 12px;">${intelligence.icon || '💻'} ${intelligence.category || 'SOFTWARE_HARDWARE'}</div>
		</div>
		
		<div style="margin-bottom: 16px;">
			<div style="color: rgba(255, 255, 255, 0.6); font-weight: 700; margin-bottom: 8px; font-size: 11px;">ACTIVE CRASH PATTERNS (${patterns.length})</div>
			<div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 10px; border-radius: 4px;">
	`;
	
	if (patterns.length > 0) {
		patterns.forEach(pattern => {
			html += `<div style="color: #fca5a5; margin-bottom: 4px;">▪ ${pattern}</div>`;
		});
	} else {
		html += `<div style="color: rgba(255, 255, 255, 0.5);">No active crash patterns detected</div>`;
	}
	
	html += `
			</div>
		</div>
		
		<div>
			<div style="color: rgba(255, 255, 255, 0.6); font-weight: 700; margin-bottom: 8px; font-size: 11px;">RECOVERY PATHS</div>
			<div style="background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; padding: 10px; border-radius: 4px;">
	`;
	
	if (recoveryPaths.length > 0) {
		recoveryPaths.forEach(path => {
			html += `<div style="color: #6ee7b7; margin-bottom: 4px;">▪ ${path}</div>`;
		});
	} else {
		html += `<div style="color: rgba(255, 255, 255, 0.5);">Standard recovery paths apply</div>`;
	}
	
	html += `
			</div>
		</div>
	`;
	
	container.innerHTML = html;
}

function populateCatalystPipeline(profile) {
	const container = document.getElementById('catalyst-data');
	const crashdash = profile.crashdash || {};
	const pipeline = crashdash.catalyst_pipeline || [];
	const aiInsights = profile.ai_insights || {};
	const expectNext = aiInsights.expect_next || {};
	const whatsHappening = aiInsights.whats_happening_now || {};
	const rnsNarrative = whatsHappening.rns_narrative || [];
	
	// Helper to extract context from RNS narrative themes
	function getContextForRNS(title, date) {
		for (const narrative of rnsNarrative) {
			if (narrative.toLowerCase().includes(title.toLowerCase()) || 
			    (date && narrative.toLowerCase().includes(date.toLowerCase()))) {
				const parts = narrative.split(':');
				if (parts.length > 1) {
					return parts.slice(1).join(':').trim();
				}
			}
		}
		return null;
	}
	
	let html = '';
	
	// Add RNS Narrative section first (thematic overview)
	if (rnsNarrative.length > 0) {
		html += `
			<div style="background: rgba(99, 102, 241, 0.1); border-left: 3px solid #6366f1; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
				<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
						<rect x="2" y="3" width="12" height="10" stroke="#6366f1" stroke-width="1.5" fill="none"/>
						<line x1="4" y1="6" x2="12" y2="6" stroke="#6366f1" stroke-width="1.5"/>
						<line x1="4" y1="9" x2="10" y2="9" stroke="#6366f1" stroke-width="1.5"/>
					</svg>
					<span style="color: #6366f1; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">RNS Narrative</span>
				</div>
				<div style="color: rgba(255, 255, 255, 0.8); font-size: 11px; line-height: 1.6;">
		`;
		
		rnsNarrative.forEach((narrative, index) => {
			html += `
				<div style="margin-bottom: ${index < rnsNarrative.length - 1 ? '10px' : '0'}; padding-left: 8px;">
					<span style="color: #6366f1; margin-right: 6px;">•</span>${narrative}
				</div>
			`;
		});
		
		html += `
				</div>
			</div>
		`;
	}
	
	// Check if we have forward-looking catalysts
	if (expectNext.near_term_catalysts?.length > 0) {
		html += '<div style="display: flex; flex-direction: column; gap: 12px;">';
		
		// Add EXPECTED section with near-term catalysts
		const nearTermCatalysts = expectNext.near_term_catalysts || [];
		if (nearTermCatalysts.length > 0) {
			html += `
				<div style="background: rgba(245, 158, 11, 0.1); border-left: 3px solid #f59e0b; padding: 12px; border-radius: 4px;">
					<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
							<path d="M8 2L8 14M8 14L12 10M8 14L4 10" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							<line x1="2" y1="14" x2="14" y2="14" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
						<span style="color: #f59e0b; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Expected</span>
					</div>
					<div style="color: rgba(255, 255, 255, 0.8); font-size: 11px; line-height: 1.6;">
			`;
			
			nearTermCatalysts.forEach((catalyst, index) => {
				html += `
					<div style="margin-bottom: ${index < nearTermCatalysts.length - 1 ? '10px' : '0'}; padding-left: 8px;">
						<span style="color: #f59e0b; margin-right: 6px;">•</span>${catalyst}
					</div>
				`;
			});
			
			html += `
					</div>
				</div>
			`;
		}
		
		html += '</div>';
		
		// Add "Watch For" footer
		const watchFor = expectNext.watch_for || '';
		if (watchFor) {
			html += `
				<div style="margin-top: 16px; padding: 12px 14px; background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; border-radius: 4px;">
					<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
							<circle cx="8" cy="8" r="6" stroke="#ef4444" stroke-width="1.5" fill="none"/>
							<circle cx="8" cy="8" r="2" fill="#ef4444"/>
							<path d="M8 2L8 4M14 8L12 8M8 14L8 12M2 8L4 8" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
						<span style="color: #ef4444; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Watch For</span>
					</div>
					<div style="color: rgba(255, 255, 255, 0.75); font-size: 11px; line-height: 1.5;">
						${watchFor}
					</div>
				</div>
			`;
		}
	} else {
		html = '<div style="color: rgba(255, 255, 255, 0.5);">No catalyst timeline available</div>';
	}
	
	container.innerHTML = html;
}

function populateMarketTape(profile) {
	const container = document.getElementById('market-data');
	const enrichment = profile.enrichment || {};
	const triangulation = profile.triangulation || {};
	const social = enrichment.social || triangulation.social || {};
	const trends = enrichment.trends || triangulation.trends || {};
	const aiInsights = profile.ai_insights || {};
	const whatsHappening = aiInsights.whats_happening_now || {};
	const crowdTape = whatsHappening.crowd_tape || {};
	
	const buzzLevel = social.buzz_level || 'LOW';
	const postCount = social.post_count || 0;
	const sentiment = social.sentiment_breakdown || { positive: 0, neutral: 100, negative: 0 };
	const trendSignal = trends.intelligence_signal || 'STABLE';
	const trendInterest = trends.current_interest || 0;
	
	const buzzColor = buzzLevel === 'HIGH' ? '#10b981' : buzzLevel === 'MEDIUM' ? '#f59e0b' : '#ef4444';
	
	let html = '';
	
	// Build Crowd Tape from either AI insights or triangulation data
	let displayCrowdTape = crowdTape;
	
	// If AI crowd tape is empty/silent but we have triangulation social data, build from that
	if ((!crowdTape.dominant_theme || crowdTape.dominant_theme.includes('silent') || crowdTape.dominant_theme.includes('muted')) && social.has_data) {
		const pos = sentiment.positive || 0;
		const neg = sentiment.negative || 0;
		const neu = sentiment.neutral || 0;
		
		let theme = '';
		if (pos > 50) theme = `Community is bullish - ${pos.toFixed(1)}% positive sentiment across ${postCount} posts`;
		else if (neg > 50) theme = `Community is bearish - ${neg.toFixed(1)}% negative sentiment across ${postCount} posts`;
		else theme = `Mixed sentiment - Neutral tone dominates (${neu.toFixed(1)}%) with ${postCount} total posts`;
		
		const bullCount = Math.round(postCount * pos / 100);
		const bearCount = Math.round(postCount * neg / 100);
		
		displayCrowdTape = {
			dominant_theme: theme,
			bull_narrative: bullCount > 0 ? `${bullCount} bullish posts (${pos.toFixed(1)}%)` : 'No strong bull narrative',
			bear_narrative: bearCount > 0 ? `${bearCount} bearish posts (${neg.toFixed(1)}%)` : 'No strong bear narrative',
			sentiment_shift: `Buzz level: ${buzzLevel} | Activity: ${postCount} community posts`
		};
	}
	
	// Add Crowd Tape section if available
	if (displayCrowdTape.dominant_theme) {
		html += `
			<div style="background: rgba(99, 102, 241, 0.1); border-left: 3px solid #6366f1; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
				<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
						<path d="M2 3h12v8H8l-3 2v-2H2V3z" stroke="#6366f1" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
						<line x1="4" y1="6" x2="10" y2="6" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round"/>
						<line x1="4" y1="8.5" x2="8" y2="8.5" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
					<span style="color: #6366f1; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Crowd Tape</span>
				</div>
				
				<div style="margin-bottom: 12px;">
					<div style="color: rgba(255, 255, 255, 0.5); font-size: 10px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Theme</div>
					<div style="color: rgba(255, 255, 255, 0.85); font-size: 11px; line-height: 1.6;">
						${displayCrowdTape.dominant_theme}
					</div>
				</div>
				
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
					<div>
						<div style="color: #10b981; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; font-weight: 700;">Bulls</div>
						<div style="color: rgba(255, 255, 255, 0.75); font-size: 11px; line-height: 1.5;">
							${displayCrowdTape.bull_narrative}
						</div>
					</div>
					<div>
						<div style="color: #ef4444; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; font-weight: 700;">Bears</div>
						<div style="color: rgba(255, 255, 255, 0.75); font-size: 11px; line-height: 1.5;">
							${displayCrowdTape.bear_narrative}
						</div>
					</div>
				</div>
				
				<div style="margin-bottom: 12px;">
					<div style="color: #f59e0b; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; font-weight: 700;">Shift</div>
					<div style="color: rgba(255, 255, 255, 0.75); font-size: 11px; line-height: 1.5;">
						${crowdTape.sentiment_shift}
					</div>
				</div>
			</div>
		`;
	}
	
	// Add Google Trends explanation if available
	if (trends.explanation) {
		html += `
			<div style="background: rgba(31, 41, 55, 0.5); border-left: 3px solid #3b82f6; padding: 12px; border-radius: 4px;">
				<div style="color: rgba(255, 255, 255, 0.75); font-size: 11px; line-height: 1.6;">
					${trends.explanation}
				</div>
			</div>
		`;
	}
	
	container.innerHTML = html;
}

function populateRNSAnnouncements(profile) {
	const container = document.getElementById('rns-data');
	const enrichment = profile.enrichment || {};
	const triangulation = profile.triangulation || {};
	const rns = triangulation.rns || enrichment.rns || {};
	const latest = rns.latest || [];
	
	if (latest.length === 0) {
		container.innerHTML = '<div style="color: rgba(255, 255, 255, 0.5);">No recent RNS announcements available</div>';
		return;
	}
	
	// Get narrative context from AI insights
	const aiInsights = profile.ai_insights || {};
	const whatsHappening = aiInsights.whats_happening_now || {};
	const rnsNarrative = whatsHappening.rns_narrative || [];
	
	// Helper to extract context from RNS narrative themes
	function getContextForRNS(title, date) {
		for (const narrative of rnsNarrative) {
			if (narrative.toLowerCase().includes(title.toLowerCase()) || 
			    (date && narrative.toLowerCase().includes(date.toLowerCase()))) {
				const parts = narrative.split(':');
				if (parts.length > 1) {
					return parts.slice(1).join(':').trim();
				}
			}
		}
		return null;
	}
	
	// Sentiment analysis helper - matches Python logic from generate_apex_profile.py
	function analyzeSentiment(title, content) {
		const titleLower = title.toLowerCase();
		const contentLower = content.toLowerCase();
		
		// BULLISH signals (Green #10b981)
		// Director dealing - purchase
		if ((titleLower.includes('director dealing') || titleLower.includes('acquisition') || titleLower.includes('purchase')) &&
		    (contentLower.includes('purchase') || contentLower.includes('acquired') || contentLower.includes('bought'))) {
			return { label: 'BULLISH', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', badge: 'DIRECTOR BUY' };
		}
		
		// Contract wins
		if (titleLower.includes('contract') || titleLower.includes('win') || titleLower.includes('award') || 
		    titleLower.includes('partnership') || titleLower.includes('agreement')) {
			return { label: 'BULLISH', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', badge: 'CONTRACT WIN' };
		}
		
		// Results with positive content
		if (titleLower.includes('result') && 
		    (contentLower.includes('profit') || contentLower.includes('growth') || 
		     contentLower.includes('increase') || contentLower.includes('strong'))) {
			return { label: 'BULLISH', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', badge: 'POSITIVE RESULTS' };
		}
		
		// BEARISH signals (Red #ef4444)
		// Director selling
		if (titleLower.includes('director') && 
		    (contentLower.includes('disposal') || contentLower.includes('sold') || contentLower.includes('sale of'))) {
			return { label: 'BEARISH', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', badge: 'DIRECTOR SELL' };
		}
		
		// Warnings and delays
		if (titleLower.includes('warning') || titleLower.includes('delay') || 
		    titleLower.includes('suspended') || titleLower.includes('loss')) {
			return { label: 'BEARISH', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', badge: 'CAUTION' };
		}
		
		// CAUTION signals (Yellow #f59e0b)
		if (titleLower.includes('change') || titleLower.includes('departure') || titleLower.includes('resignation')) {
			return { label: 'CAUTION', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', badge: 'CHANGE' };
		}
		
		// NEUTRAL signals (Blue #3b82f6)
		if (titleLower.includes('holding') || titleLower.includes('tr-1') || 
		    titleLower.includes('pdmr') || titleLower.includes('notification')) {
			return { label: 'NEUTRAL', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', badge: 'HOLDINGS' };
		}
		
		if (titleLower.includes('appointment') || titleLower.includes('board')) {
			return { label: 'NEUTRAL', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', badge: 'APPOINTMENT' };
		}
		
		// Default to NEUTRAL
		return { label: 'NEUTRAL', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', badge: 'UPDATE' };
	}
	
	// Extract key metrics from content
	function extractKeyMetrics(content) {
		const metrics = [];
		
		// Revenue patterns
		const revenueMatch = content.match(/revenue.*?[€£$]\s*(\d+(?:\.\d+)?)\s*m/i);
		if (revenueMatch) metrics.push(revenueMatch[0]);
		
		// Loss/Profit patterns
		const lossMatch = content.match(/(EBITDA loss|Loss before tax|Profit).*?[€£$]\s*(\d+(?:\.\d+)?)\s*m/i);
		if (lossMatch) metrics.push(lossMatch[0]);
		
		// Cash balance
		const cashMatch = content.match(/cash balance.*?[€£$]\s*(\d+(?:\.\d+)?)\s*m/i);
		if (cashMatch) metrics.push(cashMatch[0]);
		
		// Percentage changes
		const percentMatch = content.match(/\d+%/g);
		if (percentMatch && percentMatch.length > 0) {
			metrics.push(...percentMatch.slice(0, 3));
		}
		
		return metrics.slice(0, 3); // Max 3 metrics
	}
	
	// Take top 5 announcements
	const top5 = latest.slice(0, 5);
	
	let html = `
		<!-- Bloomberg Terminal Disclaimer Box -->
		<div style="
			margin-bottom: 20px;
			padding: 16px 18px;
			background: linear-gradient(135deg, rgba(10, 22, 40, 0.95) 0%, rgba(2, 6, 23, 0.98) 100%);
			border: 1px solid rgba(59, 130, 246, 0.25);
			border-left: 3px solid #3b82f6;
			border-radius: 6px;
			font-family: 'Courier New', monospace;
			box-shadow: 0 4px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(59, 130, 246, 0.1);
		">
			<div style="display: flex; align-items: flex-start; gap: 14px;">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink: 0; margin-top: 2px;">
					<circle cx="10" cy="10" r="8" stroke="#3b82f6" stroke-width="1.5" fill="none"/>
					<circle cx="10" cy="10" r="3" fill="#3b82f6"/>
					<path d="M10 2v6M10 12v6M2 10h6M12 10h6" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				<div style="flex: 1;">
					<div style="font-size: 11px; font-weight: 700; color: #3b82f6; margin-bottom: 10px; letter-spacing: 0.8px; text-transform: uppercase;">
						▸ RNS Intelligence Framework
					</div>
					<div style="font-size: 10px; color: rgba(255, 255, 255, 0.7); line-height: 1.7; margin-bottom: 10px;">
						Each RNS includes sentiment classification, key data extraction, and trading context. 
						Color-coded badges indicate bullish (green), bearish (red), or neutral (blue) signals.
					</div>
					<div style="
						font-size: 9px; 
						color: #fca5a5; 
						font-weight: 600; 
						padding: 8px 12px;
						background: rgba(239, 68, 68, 0.12);
						border-left: 2px solid #ef4444;
						border-radius: 4px;
						margin-top: 10px;
						letter-spacing: 0.3px;
						display: flex;
						align-items: center;
						gap: 8px;
					">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
							<path d="M8 1L8 11M8 14v1" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/>
							<circle cx="8" cy="13" r="0.8" fill="#ef4444"/>
							<path d="M7 2L8 1L9 2M2 8L1 7L2 6M14 8L15 7L14 6" stroke="#ef4444" stroke-width="1.2" stroke-linecap="round"/>
						</svg>
						<span>REGULATORY NEWS ANALYSIS FOR INFORMATIONAL PURPOSES ONLY • NOT INVESTMENT ADVICE</span>
					</div>
				</div>
			</div>
		</div>
		
		<div style="display: flex; flex-direction: column; gap: 16px;">`;
	
	top5.forEach((announcement, index) => {
		const title = announcement.title || 'Untitled';
		const date = announcement.date || announcement.announcement_date || 'Unknown date';
		const releaseTime = announcement.release_time || '';
		const rnsNumber = announcement.rns_number || '';
		const source = announcement.source || 'RNS';
		const content = announcement.content || '';
		
		const sentiment = analyzeSentiment(title, content);
		const keyMetrics = extractKeyMetrics(content);
		
		// Extract person/entity from content
		let personEntity = 'Companies Registration';
		const ceoMatch = content.match(/(David Whelan|CEO|Chief Executive Officer)/);
		if (ceoMatch) personEntity = 'David Whelan, CEO';
		
		html += `
			<div style="background: rgba(31, 41, 55, 0.5); border-radius: 8px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.05);">
				<!-- Header with number badge -->
				<div style="padding: 10px 14px; background: rgba(0, 0, 0, 0.2); border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; gap: 10px;">
					<div style="width: 28px; height: 28px; border-radius: 50%; background: ${sentiment.color}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #000;">
						${index + 1}
					</div>
					<span style="color: rgba(255, 255, 255, 0.5); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">RNS ANNOUNCEMENT #${index + 1}</span>
				</div>
				
				<!-- Title banner with sentiment/date below title -->
				<div style="background: ${sentiment.bg}; padding: 14px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
					<!-- Row 1: Icon + Title on left, DATE on right -->
					<div style="display: flex; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 8px;">
						<div style="display: flex; align-items: center; gap: 12px; flex: 1;">
							<svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
								<rect x="2" y="2" width="12" height="12" rx="1" stroke="${sentiment.color}" stroke-width="1.5" fill="none"/>
								<path d="M5 7h6M5 10h4" stroke="${sentiment.color}" stroke-width="1.5" stroke-linecap="round"/>
								<circle cx="5" cy="4.5" r="0.5" fill="${sentiment.color}"/>
								<circle cx="8" cy="4.5" r="0.5" fill="${sentiment.color}"/>
								<circle cx="11" cy="4.5" r="0.5" fill="${sentiment.color}"/>
							</svg>
							<div style="color: #fff; font-weight: 700; font-size: 14px;">${title}</div>
						</div>
						<div style="color: rgba(255, 255, 255, 0.6); font-size: 12px; font-weight: 700; flex-shrink: 0;">${date}</div>
					</div>
					<!-- Row 2: SENTIMENT on left, TIME on right -->
					<div style="display: flex; align-items: center; gap: 12px; justify-content: space-between;">
						<div style="display: inline-block; background: ${sentiment.color}; color: #000; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
							${sentiment.label}
						</div>
						<div style="color: rgba(255, 255, 255, 0.4); font-size: 11px; flex-shrink: 0;">${releaseTime || '--'}</div>
					</div>
					${
						(() => {
							const context = getContextForRNS(title, date);
							return context ? `
								<div style="color: rgba(255, 255, 255, 0.7); font-size: 12px; line-height: 1.6; margin-top: 10px; padding: 10px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; border-left: 2px solid ${sentiment.color};">
									<div style="color: rgba(255, 255, 255, 0.5); font-size: 10px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Context</div>
									${context}
								</div>
							` : '';
						})()
					}
				</div>
				
				<!-- Metadata grid removed - DATE/TIME now in title -->
				
				<!-- Key Data Points (hidden by default, shown when expanded) -->
				${keyMetrics.length > 0 ? `
				<div id="rns-key-${index}" style="display: none; padding: 14px 16px; background: rgba(0, 0, 0, 0.15); border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
					<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
<rect x="2" y="10" width="3" height="4" fill="#fff" opacity="0.7"/>
<rect x="6.5" y="6" width="3" height="8" fill="#fff" opacity="0.7"/>
<rect x="11" y="3" width="3" height="11" fill="#fff" opacity="0.7"/>
</svg>
						<span style="color: #fff; font-weight: 700; font-size: 12px;">Key Data Points:</span>
					</div>
					<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
						<div>
							<div style="color: rgba(255, 255, 255, 0.5); font-size: 10px; text-transform: uppercase; margin-bottom: 4px;">PERSON/ENTITY:</div>
							<div style="color: #d1d5db; font-size: 11px;">${personEntity}</div>
						</div>
						<div>
							<div style="color: rgba(255, 255, 255, 0.5); font-size: 10px; text-transform: uppercase; margin-bottom: 4px;">KEY METRICS:</div>
							<div style="color: #d1d5db; font-size: 11px;">${keyMetrics.join(', ')}</div>
						</div>
					</div>
				</div>
				` : ''}
				
				<!-- Context (hidden by default, shown when expanded) -->
				${
					(() => {
						const context = getContextForRNS(title, date);
						return context ? `
							<div id="rns-ctx-${index}" style="display: none; color: rgba(255, 255, 255, 0.7); font-size: 12px; line-height: 1.6; padding: 10px 16px; background: rgba(0, 0, 0, 0.2); border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
								<div style="color: rgba(255, 255, 255, 0.5); font-size: 10px; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">Context</div>
								${context}
							</div>
						` : '';
					})()
				}
				
				<!-- View Full RNS button -->
				<div style="padding: 12px 16px; background: rgba(0, 0, 0, 0.1);">
					<button onclick="toggleRNSFull('rns-full-${index}'); return false;" style="width: 100%; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #d1d5db; padding: 10px; border-radius: 6px; cursor: pointer; font-family: 'Courier New', monospace; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
						<span style="display: flex; align-items: center; justify-content: center; gap: 8px;">
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
								<rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
								<path d="M4 6h8M4 9h8M4 12h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
							</svg>
							<span id="rns-toggle-text-${index}">View Full RNS</span>
						</span>
					</button>
				</div>
				
				<!-- Full content (hidden by default) -->
				<div id="rns-full-${index}" style="display: none; padding: 16px; background: rgba(0, 0, 0, 0.4); border-top: 1px solid rgba(255, 255, 255, 0.05); max-height: 400px; overflow-y: auto;">
					<pre style="color: rgba(255, 255, 255, 0.7); font-size: 10px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; margin: 0; font-family: 'Courier New', monospace;">${content}</pre>
				</div>
			</div>
		`;
	});
	
	html += '</div>';
	
	// Add count footer
	const totalCount = latest.length;
	if (totalCount > 5) {
		html += `
			<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
				<span style="color: rgba(255, 255, 255, 0.5); font-size: 11px;">Showing 5 of ${totalCount} announcements</span>
			</div>
		`;
	}
	
	container.innerHTML = html;
}

// Toggle full RNS content
function toggleRNSFull(id) {
	const fullDiv = document.getElementById(id);
	const toggleText = document.getElementById(id.replace('rns-full-', 'rns-toggle-text-'));
	const keyDiv = document.getElementById(id.replace('rns-full-', 'rns-key-'));
	const ctxDiv = document.getElementById(id.replace('rns-full-', 'rns-ctx-'));
	
	if (fullDiv.style.display === 'none') {
		fullDiv.style.display = 'block';
		if (keyDiv) keyDiv.style.display = 'block';
		if (ctxDiv) ctxDiv.style.display = 'block';
		if (toggleText) toggleText.textContent = 'Hide Full RNS';
	} else {
		fullDiv.style.display = 'none';
		if (keyDiv) keyDiv.style.display = 'none';
		if (ctxDiv) ctxDiv.style.display = 'none';
		if (toggleText) toggleText.textContent = 'View Full RNS';
	}
}

function populateInvestmentDecision(profile) {
	try {
		const container = document.getElementById('decision-data');
		if (!container) return;
		
		const aiInsights = profile.ai_insights || {};
		const buyVsSell = aiInsights.buy_vs_sell || {};
		const playbook = aiInsights.playbook || {};
		
		const lean = buyVsSell.lean || 'Neutral';
		const bullCase = buyVsSell.bull_case || 'N/A';
		const bearCase = buyVsSell.bear_case || 'N/A';
		const riskReward = buyVsSell.risk_reward || 'N/A';
		const ifBullish = playbook.if_bullish || 'N/A';
		const ifWatching = playbook.if_watching || 'N/A';
		const ifPassing = playbook.if_passing || 'N/A';
		const bottomLine = aiInsights.bottom_line || 'N/A';
		
		// Color based on lean
		const leanColor = lean === 'Bearish' ? '#ef4444' : lean === 'Bullish' ? '#10b981' : '#f59e0b';
		const leanBg = lean === 'Bearish' ? 'rgba(239, 68, 68, 0.1)' : lean === 'Bullish' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)';
	
	const html = `
		<!-- Market Assessment -->
		<div style="margin-bottom: 16px;">
			<div style="color: #a0aec0; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">📈 MARKET ASSESSMENT</div>
			
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
				<!-- Bull Case -->
				<div style="background: rgba(16, 185, 129, 0.1); border-left: 2px solid #10b981; padding: 10px; border-radius: 3px;">
					<div style="color: #10b981; font-size: 10px; font-weight: 700; margin-bottom: 4px;">🐂 BULL CASE</div>
					<div style="color: rgba(255, 255, 255, 0.7); font-size: 10px; line-height: 1.5;">
						${bullCase}
					</div>
				</div>
				
				<!-- Bear Case -->
				<div style="background: rgba(239, 68, 68, 0.1); border-left: 2px solid #ef4444; padding: 10px; border-radius: 3px;">
					<div style="color: #ef4444; font-size: 10px; font-weight: 700; margin-bottom: 4px;">🐻 BEAR CASE</div>
					<div style="color: rgba(255, 255, 255, 0.7); font-size: 10px; line-height: 1.5;">
						${bearCase}
					</div>
				</div>
			</div>
			
			<!-- Risk/Reward -->
			<div style="background: rgba(0, 0, 0, 0.3); padding: 8px 10px; border-radius: 3px; font-size: 10px; color: rgba(255, 255, 255, 0.6);">
				<strong style="color: rgba(255, 255, 255, 0.8);">Risk/Reward:</strong> ${riskReward}
			</div>
		</div>

		<!-- Playbook -->
		<div style="margin-bottom: 12px;">
			<div style="color: #a0aec0; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">🎯 YOUR PLAYBOOK</div>
			
			<div style="display: flex; flex-direction: column; gap: 8px;">
				<!-- If Bullish -->
				<div style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.2); padding: 8px; border-radius: 3px;">
					<div style="color: #22c55e; font-size: 9px; font-weight: 700;">IF BULLISH</div>
					<div style="color: rgba(255, 255, 255, 0.6); font-size: 9px; margin-top: 2px;">
						${ifBullish}
					</div>
				</div>
				
				<!-- If Watching -->
				<div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); padding: 8px; border-radius: 3px;">
					<div style="color: #3b82f6; font-size: 9px; font-weight: 700;">IF WATCHING</div>
					<div style="color: rgba(255, 255, 255, 0.6); font-size: 9px; margin-top: 2px;">
						${ifWatching}
					</div>
				</div>
				
				<!-- If Passing -->
				<div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 8px; border-radius: 3px;">
					<div style="color: #ef4444; font-size: 9px; font-weight: 700;">IF PASSING</div>
					<div style="color: rgba(255, 255, 255, 0.6); font-size: 9px; margin-top: 2px;">
						${ifPassing}
					</div>
				</div>
			</div>
		</div>
		
		<!-- Bottom Line -->
		<div style="padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
			<div style="background: linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%); padding: 10px; border-radius: 3px;">
				<div style="color: #ef4444; font-size: 9px; font-weight: 700; margin-bottom: 4px;">⚠️ BOTTOM LINE</div>
				<div style="color: rgba(255, 255, 255, 0.75); font-size: 9px; line-height: 1.6;">
					${bottomLine}
				</div>
			</div>
		</div>
	`;
		
		container.innerHTML = html;
	} catch (e) {
		console.error('populateInvestmentDecision error:', e);
		document.getElementById('decision-data').innerHTML = '<div style="color: rgba(255, 0, 0, 0.7);">Error loading data: ' + e.message + '</div>';
	}
}

function render(data){
	// Populate stock header and Bloomberg sections with original profile data
	if (window.__APEX_PROFILE) {
		populateStockHeader(window.__APEX_PROFILE);
		populateCompany30Sec(window.__APEX_PROFILE);
		populateScorecard(window.__APEX_PROFILE);
		populateBloombergSections(window.__APEX_PROFILE);
		populateFooter(window.__APEX_PROFILE);
		initializeNarrativeStack();
	}
	
	// Render the 5 swipeable cards
	renderComponentGrid(data);
}

function populateFooter(profile) {
	try {
		const enrichment = profile.enrichment || {};
		const latest = enrichment.latest_signal || {};
		const topCard = profile.top_card || {};
		
		// Ticker
		const tickerEl = document.getElementById('footerTicker');
		if (tickerEl) tickerEl.textContent = profile.symbol || '--';
		
		// Generated date
		const dateEl = document.getElementById('footerDate');
		if (dateEl) {
			const genDate = profile.generated_at || '';
			const dateFormatted = genDate ? new Date(genDate).toLocaleString('en-GB', { 
				year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
			}) : '--';
			dateEl.textContent = dateFormatted;
		}
		
		// Signal type
		const sigTypeEl = document.getElementById('footerSignalType');
		if (sigTypeEl) {
			const signalType = latest.signal_type || topCard.signal_type || '--';
			sigTypeEl.textContent = signalType;
		}
		
		// Signal date
		const sigDateEl = document.getElementById('footerSignalDate');
		if (sigDateEl) {
			const signalDate = latest.date || topCard.signal_date || '--';
			sigDateEl.textContent = signalDate;
		}
		
		// APEX score
		const apexEl = document.getElementById('footerApex');
		if (apexEl) {
			const apexScore = topCard.apex_score_100 || (profile.comprehensive_apex && profile.comprehensive_apex.score) || '--';
			apexEl.textContent = apexScore;
		}
	} catch(e) {
		console.error('populateFooter failed', e);
	}
}

function renderComponentGrid(data){
	let grid = document.getElementById('component-grid');
	if(!grid) return;
	grid.className = 'card-stack'; // Add card-stack class for proper styling
	grid.innerHTML = '';
	
	// Add 4 main component cards
	data.components.forEach((c, idx)=>{
		const card = document.createElement('div'); 
		card.className='card component-card stack-card';
		card.dataset.index = idx;
		const extra = (data.extra && data.extra[c.name.toLowerCase()]) || {};
		const score = pct(c.score);
		const bloomberg = getBloombergExplanation(c.name, c.score, data.extra);
		const tooltip = getCardTooltip(c.name);
		
		// Compose progress-scale with threshold markers (50 & 70) and colored fill
		const fillColor = colorFor(c.name);
		const bloombergBar = createBloombergProgressBar(c.score, fillColor);
		const neutralPos = 50; const strongPos = 70;
			// build breakdown HTML separately to avoid nested template-literal complexity
			// For Trust, pass data (which has trust.coverage); for others pass data.extra[componentName]
			const tileExtraData = c.name === 'Trust' ? data : data.extra[c.name.toLowerCase()];
			const breakdownHTML = (['Compression','Setup','Trust','Panic'].includes(c.name) ?
				renderComponentTilesHTML(c.name.toLowerCase(), tileExtraData, data)
				: (
					'<div class="small">Component breakdown</div>' +
					'<div class="progress-scale" style="border-width:' + (2 + (c.weight*6)) + 'px">' +
						'<div class="fill" style="width:' + score + '%;background:' + fillColor + '"></div>' +
						'<div class="threshold" style="left:' + neutralPos + '%" title="Neutral (50)"></div>' +
						'<div class="threshold" style="left:' + strongPos + '%" title="Strong (70)"></div>' +
					'</div>' +
					'<div class="label-small">0 — <span style="color:var(--muted)">Neutral @50</span> — Strong @70 — 100</div>' +
					'<div class="component-metrics">' +
						'<div class="metric">Percentile: <strong>' + c.percentile + '%</strong></div>' +
						'<div class="metric">Z-score: <strong>' + computeZ(c.score,c.std) + '</strong></div>' +
						'<div class="metric">Weight impact: <strong>' + Math.round((c.weight||0)*100) + '%</strong></div>' +
					'</div>' +
					'<div class="small">Key metrics</div>' +
					'<div class="component-metrics">' + renderExtraMetricsHTML(c.name.toLowerCase(), extra, data) + '</div>'
				)
			);

			card.innerHTML = `
		<div class="panel-header" style="padding:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
			<div class="card-title" style="font-size:16px;font-weight:800">${c.name} <span style="cursor:help;opacity:0.6;font-size:14px" title="${tooltip.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}">\u24d8</span></div>
			<div style="margin-top:8px;">${bloombergBar}</div>
			<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.5);font-family:'Courier New',monospace;">${score}/100 · ${Math.round((c.weight||0)*100)}% weight</div>
		</div>
				<div class="component-row-breakdown" style="padding:12px">` + breakdownHTML + `
					<div style="margin-top:8px"><div class="small">Sparkline</div><div class="spark" style="height:40px" data-name="spark-${c.name}"></div></div>
					<div class="bloomberg-explanation" style="margin-top:8px;padding:10px;background:rgba(31,41,55,0.3);border-radius:4px;border-left:3px solid ${bloomberg.color}">
						<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
							<div style="font-size:11px;font-weight:700;color:${bloomberg.color};letter-spacing:0.5px">${bloomberg.status}</div>
							${renderProgressDots(c.score)}
							<div style="font-size:20px;font-weight:800;color:${fillColor}">${score}</div>
						</div>
						<div style="font-size:12px;color:#d1d5db;line-height:1.5">${bloomberg.detail}</div>
					</div>
					<div class="weight-indicator"><div class="weight-fill" style="width:${(c.weight||0)*100}%;background:${fillColor}"></div></div>
				</div>
			`;
		grid.appendChild(card);
		const sparkEl = card.querySelector('.spark'); sparkEl.__data__ = c.sparkline; drawSpark(sparkEl,c.sparkline);
	});
	
	// Add 5th card: Risk Audit
	const riskCard = createRiskAuditCard(data, 4);
	grid.appendChild(riskCard);
	
	// Add navigation controls AFTER the grid (not inside it, so overflow:hidden won't clip)
	let nav = grid.nextElementSibling;
	if(!nav || !nav.classList.contains('stack-nav')){
		nav = document.createElement('div');
		nav.className = 'stack-nav';
		nav.innerHTML = `
			<div class="stack-dots"></div>
			<div class="stack-label"></div>
		`;
		grid.parentNode.insertBefore(nav, grid.nextSibling);
	}
	
	// Update dots for 5 cards (4 components + Risk Audit)
	const cardNames = [...data.components.map(c => c.name), 'Risk Audit'];
	const dotsContainer = nav.querySelector('.stack-dots');
	dotsContainer.innerHTML = cardNames.map((name, i) => 
		`<span class="stack-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`
	).join('');
	
	// Update label
	nav.querySelector('.stack-label').textContent = cardNames[0];
	
	// Initialize swipe behavior with 5 cards
	initCardSwipe(grid, nav, cardNames);
}

// Composite stack renderer removed — contributions panel not needed in prototype

function initializeNarrativeStack() {
	const narrativeStack = document.getElementById('narrative-stack');
	if (!narrativeStack) return;
	
	// Find the nav that follows the narrative stack
	const nav = narrativeStack.nextElementSibling;
	const cardNames = ['What They Do', 'Why It Matters', 'Current State'];
	initCardSwipe(narrativeStack, nav, cardNames);
}

function initCardSwipe(container, navElement, cardNames) {
	let currentIndex = 0;
	let isDragging = false;
	let startX = 0;
	let currentX = 0;
	let startY = 0;
	const threshold = 80; // pixels to swipe before committing
	
	const cards = Array.from(container.querySelectorAll('.stack-card'));
	const dots = navElement ? Array.from(navElement.querySelectorAll('.stack-dot')) : [];
	const label = navElement ? navElement.querySelector('.stack-label') : null;
	
	function updateCardPositions(animated = true) {
		cards.forEach((card, idx) => {
			const offset = idx - currentIndex;
			card.style.transition = animated ? 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none';
			card.style.transform = `translateX(${offset * 100}%) scale(${1 - Math.abs(offset) * 0.05})`;
			card.style.opacity = offset === 0 ? '1' : '0.3';
			card.style.pointerEvents = offset === 0 ? 'auto' : 'none';
			card.style.zIndex = 10 - Math.abs(offset);
		});
		
		dots.forEach((dot, idx) => dot.classList.toggle('active', idx === currentIndex));
		if(label) label.textContent = cardNames[currentIndex];
	}
	
	function goToCard(index) {
		currentIndex = Math.max(0, Math.min(cardNames.length - 1, index));
		updateCardPositions();
	}
	
	function handleStart(e) {
		isDragging = true;
		startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
		startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
		currentX = startX;
		cards[currentIndex].style.transition = 'none';
	}
	
	function handleMove(e) {
		if (!isDragging) return;
		e.preventDefault();
		currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
		const currentY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
		const deltaX = currentX - startX;
		const deltaY = Math.abs(currentY - startY);
		
		// Only drag horizontally if horizontal movement dominates
		if (Math.abs(deltaX) > deltaY) {
			const dragPercent = (deltaX / window.innerWidth) * 100;
			cards[currentIndex].style.transform = `translateX(${dragPercent}%) scale(1)`;
		}
	}
	
	function handleEnd(e) {
		if (!isDragging) return;
		isDragging = false;
		const deltaX = currentX - startX;
		const velocity = Math.abs(deltaX);
		
		if (velocity > threshold || Math.abs(deltaX) > window.innerWidth * 0.3) {
			if (deltaX < 0 && currentIndex < cardNames.length - 1) {
				goToCard(currentIndex + 1);
			} else if (deltaX > 0 && currentIndex > 0) {
				goToCard(currentIndex - 1);
			} else {
				updateCardPositions();
			}
		} else {
			updateCardPositions();
		}
	}
	
	// Touch events
	container.addEventListener('touchstart', handleStart, { passive: false });
	container.addEventListener('touchmove', handleMove, { passive: false });
	container.addEventListener('touchend', handleEnd);
	
	// Mouse events
	container.addEventListener('mousedown', handleStart);
	document.addEventListener('mousemove', handleMove);
	document.addEventListener('mouseup', handleEnd);
	
	// Keyboard navigation
	document.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowLeft') goToCard(currentIndex - 1);
		if (e.key === 'ArrowRight') goToCard(currentIndex + 1);
	});
	
	// Dot navigation
	dots.forEach((dot, idx) => {
		dot.addEventListener('click', () => goToCard(idx));
	});
	
	// Initialize
	updateCardPositions(false);
}

function getCardTooltip(componentName){
	const c = (componentName||'').toLowerCase();
	if(c === 'setup'){
		return 'SETUP: Is the technical foundation strong?\n• AI Tech: Machine learning pattern quality (0-25)\n• Rel Vol: Volume surge vs. baseline (0-10)\n• Rallies: Count of historical bounces (0-15)\n• Best Rally: Maximum historical return (0-20)';
	}
	if(c === 'trust'){
		return 'TRUST: How confident are we in the data?\n• RNS: Regulatory news tracked (50 items = 100%)\n• Social: Social sentiment posts (1000 posts = 100%)\n• Trends: Google/web trend signals (active = 100%)\n• History: Price bars for patterns (1000 bars = 100%)\nHigher coverage + reliability = more reliable analysis';
	}
	if(c === 'panic'){
		return 'PANIC: How extreme is the crash?\n• Price: Severity of price destruction (0-40)\n• Volume: Abnormality of trading volume (0-20)\n• Social: Lack of discussion/fear (0-20)\n• News: Negativity of announcements (0-20)\nHigher panic = deeper contrarian opportunity';
	}
	if(c === 'compression'){
		return 'COMPRESSION: Is the setup coiled & ready to pop?\n• Compression: Signal density clustering (0-40)\n• Intensification: How quickly crash intensifying (0-20)\n• Volume death: Capitulation exhaustion level (0-15)\n• Pop potential: Historical upside runway (0-15)\n• Accumulation: Smart money buying detected (0-10)\n  - Score 10: Fresh accumulation NOW\n  - Score 0: No accumulation detected = institutional buyers haven\'t stepped in yet\nHigh compression + accumulation = highest probability explosive reversal';
	}
	return 'Component scoring breakdown';
}

function ratingFor(score){ if(score>=80) return 'EXCELLENT'; if(score>=60) return 'GOOD'; if(score>=40) return 'FAIR'; if(score>=20) return 'POOR'; return 'CRITICAL'; }

function getBloombergExplanation(component, score, extra){
	const c = (component||'').toLowerCase();
	const name = component.charAt(0).toUpperCase() + component.slice(1);
	
	if(c === 'setup'){
		let status = '', detail = '';
		if(score < 40){ 
			status = 'WEAK'; 
			detail = 'Weak technicals';
		}else if(score < 60){ 
			status = 'FAIR'; 
			detail = 'Some technical support';
		}else{ 
			status = 'GOOD'; 
			detail = 'Chart looks constructive';
		}
		return {status, detail, color: score<40?'#ef4444':score<60?'#f59e0b':'#10b981'};
	}
	
	if(c === 'trust'){
		let status = '', detail = '';
		if(score < 40){ 
			status = 'LOW'; 
			detail = 'Low confidence';
		}else if(score < 60){ 
			status = 'MODERATE'; 
			detail = 'Partial confidence';
		}else{ 
			status = 'HIGH'; 
			detail = 'High data confidence';
		}
		return {status, detail, color: score<40?'#ef4444':score<60?'#f59e0b':'#10b981'};
	}
	
	if(c === 'panic'){
		let status = '', detail = '';
		if(score < 60){ 
			status = 'CALM'; 
			detail = 'Not yet panicked';
		}else{ 
			status = 'OPPORTUNITY'; 
			detail = 'Opportunity: high panic';
		}
		return {status, detail, color: score<60?'#6b7280':'#10b981'};
	}
	
	if(c === 'compression'){
		let status = '', detail = '';
		if(score < 60){ 
			status = 'LOW'; 
			detail = 'Low congestion';
		}else{ 
			status = 'HIGH'; 
			detail = 'High congestion \u2014 potential pop';
		}
		return {status, detail, color: score<60?'#6b7280':'#10b981'};
	}
	
	return {status: 'N/A', detail: 'No data', color: '#6b7280'};
}

function renderProgressDots(score){
	// Create a progress indicator with 5 larger, clearer dots
	// Show position on 0-20-40-60-80-100 scale
	const thresholds = [0, 20, 40, 60, 80];
	let html = '<div style="display:flex;gap:6px;align-items:center">';
	for(let i=0; i<thresholds.length; i++){
		const t = thresholds[i];
		const nextT = thresholds[i+1] || 100;
		const active = score >= t && score < nextT;
		const passed = score >= nextT;
		
		let dotColor = '#1f2937'; // default faint watermark
		let borderColor = 'rgba(156,163,175,0.2)'; // faint border
		
		if(passed){
			dotColor = '#4b5563'; // dim gray if passed
			borderColor = 'rgba(156,163,175,0.4)';
		}
		if(active){
			// Active dot gets bright color based on zone
			if(t < 40) { dotColor = '#ef4444'; borderColor = '#ef4444'; } // red
			else if(t < 60) { dotColor = '#f59e0b'; borderColor = '#f59e0b'; } // amber  
			else if(t < 80) { dotColor = '#10b981'; borderColor = '#10b981'; } // green
			else { dotColor = '#06b6d4'; borderColor = '#06b6d4'; } // cyan
		}
		
		const size = active ? '10px' : '8px';
		const pulse = active ? 'animation:pulse 2s ease-in-out infinite;' : '';
		html += `<div style="width:${size};height:${size};border-radius:50%;background:${dotColor};border:2px solid ${borderColor};transition:all 0.3s;${pulse}"></div>`;
	}
	html += '</div>';
	return html;
}

function renderExtraMetricsHTML(name, extra, data){
	if(!extra) return '';
	try{
		if(name==='setup'){
			const ai = extra.ai_technical_score || 0;
			const dd = extra.drawdown_pct || 0;
			const rv = extra.relative_volume || 0;
			const rc = extra.rally_count || 0;
			const best = extra.best_historical_rally || 0;
			const aiP = metricPct('ai_technical_score', ai);
			const ddP = metricPct('drawdown_pct', dd);
			const rvP = metricPct('relative_volume', rv);
			const rcP = metricPct('rally_count', rc);
			const bestP = metricPct('best_historical_rally', best);
			return `
				<div class="component-tiles" style="display:flex;flex-direction:row;gap:8px;margin-top:6px;flex-wrap:wrap">
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">AI Tech</div><div class="small">${ai}</div><div class="progress"><i style="width:${aiP}%;background:${getHeatMapColor(aiP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Drawdown</div><div class="small">${dd}%</div><div class="progress"><i style="width:${ddP}%;background:${getHeatMapColor(ddP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Rel Vol</div><div class="small">${rv}</div><div class="progress"><i style="width:${rvP}%;background:${getHeatMapColor(rvP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Rallies</div><div class="small">${rc}</div><div class="progress"><i style="width:${rcP}%;background:${getHeatMapColor(rcP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Best Rally</div><div class="small">${best}%</div><div class="progress"><i style="width:${bestP}%;background:${getHeatMapColor(bestP)}"></i></div></div>
				</div>
				<div class="metric">Best Rally: <strong>${extra.best_historical_rally||'--'}%</strong></div>
			`;
		}
		if(name==='panic'){
			const pd = extra.price_destruction || 0;
			const vd = extra.volume_death || 0;
			const ss = extra.social_silence || 0;
			const ns = extra.news_sentiment || 0;
			const pdP = metricPct('price_destruction', pd);
			const vdP = metricPct('volume_death', vd);
			const ssP = metricPct('social_silence', ss);
			const nsP = metricPct('news_sentiment', ns);
			return `
				<div class="panic-tiles" style="display:flex;flex-direction:row;gap:8px;margin-top:6px;flex-wrap:wrap">
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Price Destr</div><div class="small">${pd}</div><div class="progress"><i style="width:${pdP}%;background:${getHeatMapColor(pdP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Vol Death</div><div class="small">${vd}</div><div class="progress"><i style="width:${vdP}%;background:${getHeatMapColor(vdP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">Social</div><div class="small">${ss}</div><div class="progress"><i style="width:${ssP}%;background:${getHeatMapColor(ssP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:120px"><div style="font-weight:700">News Sent</div><div class="small">${ns}</div><div class="progress"><i style="width:${nsP}%;background:${getHeatMapColor(nsP)}"></i></div></div>
				</div>
			`;
		}
		if(name==='compression'){
			// Compression metrics are shown in the dedicated compression breakdown bars;
			// avoid duplicating the same tiles here.
			return '';
		}
		if(name==='trust'){
			return `
				<div class="metric">Sample size: <strong>${(data && data.trust && data.trust.sample_size)?data.trust.sample_size:'--'}</strong></div>
				<div class="metric">CI: <strong>${(data && data.trust && data.trust.ci_low)?data.trust.ci_low+' – '+data.trust.ci_high:'--'}</strong></div>
			`;
		}
	}catch(e){console.warn('renderExtraMetricsHTML failed',e)}
	return '';
}

function interpretation(name,score){
	if(name==='Setup') return score>60? 'Chart looks constructive' : score>40? 'Some technical support' : 'Weak technicals';
	if(name==='Trust') return score>60? 'High data confidence' : score>40? 'Partial confidence' : 'Low confidence';
	if(name==='Panic') return score>=60? 'Opportunity: high panic' : 'Not yet panicked';
	if(name==='Compression') return score>=60? 'High congestion — potential pop' : 'Low congestion';
	return '';
}

function computeZ(score,std){ if(!std || std<=0) return '--'; const z = ((score-50)/std).toFixed(2); return z; }

function proximityText(score){
	if(score>=70) return '🟢 Strong — above 70';
	if(score>=50) return `🟡 Near neutral — needs +${50-score} to reach NEUTRAL`;
	return `🔴 Weak — needs +${50-score} to reach NEUTRAL`;
}


function colorFor(name){if(name==='Setup')return 'var(--blue)';if(name==='Trust')return 'var(--purple)';if(name==='Panic')return 'var(--red)';return 'var(--amber)'}
function coverageColor(p){if(p>85) return '#10b981'; if(p>60) return '#f59e0b'; return '#ef4444'}
function drawSpark(el,arr){const w=el.clientWidth||200,h=36;const max=Math.max(...arr),min=Math.min(...arr);const pts=arr.map((v,i)=>{const x=(i/(arr.length-1||1))*w;const y=h-((v-min)/(max-min||1))*h;return `${x},${y}`}).join(' ');el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%"><polyline points="${pts}" fill="none" stroke="#1fb6ae" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`}
function metricPct(metric, val){
	if(val==null || isNaN(val)) return 0;
	switch(metric){
		case 'signals_per_week': return Math.min(100, Math.round(val*10)); // scale: 10wk -> 100
		case 'rsi_extreme_count': return Math.min(100, Math.round(val*20)); // scale: 5 -> 100
		case 'escalation_events': return Math.min(100, Math.round(val*25)); // scale: 4 -> 100
		case 'pop_potential': return Math.max(0, Math.min(100, Math.round(val)));
		// Setup metrics
		case 'ai_technical_score': return Math.min(100, Math.round(val * 4)); // ai score out of 25 -> percent
		case 'drawdown_pct': return Math.max(0, Math.min(100, Math.round(100 - val))); // lower drawdown == better
		case 'relative_volume': return Math.max(0, Math.min(100, Math.round(val * 100))); // relative vol (0-1)
		case 'rally_count': return Math.min(100, Math.round(val * 10)); // count -> scale
		case 'best_historical_rally': return Math.max(0, Math.min(100, Math.round(val)));
		// Panic metrics
		case 'price_destruction': return Math.max(0, Math.min(100, Math.round(val)));
		case 'volume_death': return Math.max(0, Math.min(100, Math.round(val * 100)));
		case 'social_silence': return Math.max(0, Math.min(100, Math.round(val * 100)));
		case 'news_sentiment': return Math.max(0, Math.min(100, Math.round(val * 100)));
		default: return Math.max(0, Math.min(100, Math.round(val)));
	}
}

function bandToPct(b){ if(!b) return 50; if(typeof b!=='string') return 50; const s=b.toUpperCase(); if(s.includes('HIGH')) return 85; if(s.includes('MOD')) return 50; if(s.includes('LOW')) return 20; return 50 }

function renderComponentTilesHTML(name, extra, data){
	try{
		const n = (name||'').toLowerCase();
		if(!extra) { extra = {}; console.warn(`renderComponentTilesHTML: extra was falsy for ${name}`)};
		if(n === 'compression'){
			const sig = extra.signals_per_week || 0;
			const rsi = extra.rsi_extreme_count || 0;
			const esc = extra.escalation_events || 0;
			const pop = extra.pop_potential || 0;
			const band = extra.congestion_band || 'MOD';
			// Calculate component scores based on contrarian_panic_scorer.py
			// Compression: density (signals/wk) + RSI extremes = /40 total
			const densityScore = Math.round(Math.min(20, (sig / 1.0) * 20)); // signals contribute /20
			const rsiScore = Math.round(Math.min(20, (rsi / 5) * 20)); // RSI extremes contribute /20
			const compressionScore = densityScore + rsiScore; // Total /40
			// Intensification: from data directly
			const intensScore = extra.intensification_score || 0;
			const intensPattern = extra.intensification_pattern || '';
			// Pop potential = /15
			const popScore = Math.round(Math.min(15, (Math.min(pop, 1000) / 1000) * 15)); // Pop /15
			// Volume death and accumulation scores from data
			const vdScore = extra.volume_death_score || 0;
			const vdDesc = extra.volume_death_desc || '';
			const accumScore = extra.accumulation_score || 0;
			const accumDesc = extra.accumulation_desc || '';
			const compP = Math.round((compressionScore / 40) * 100);
			const intensP = Math.round((intensScore / 20) * 100);
			const vdP = Math.round((vdScore / 15) * 100);
			const popP = Math.round((popScore / 15) * 100);
			const accumP = Math.round((accumScore / 10) * 100);
			const tooltips = {
				'Compression': 'Technical signal density. How many crash/crash signals are bunching up together (coiled spring effect).',
				'Intensification': 'Escalation of crash intensity. How quickly the signals are intensifying in the pattern.',
				'Volume death': 'Volume collapse degree. Lower volume = capitulation/exhaustion (panic selling is done).',
				'Pop potential': 'Historical bounce potential. Best previous rally return = upside runway available.',
				'Accumulation': 'Smart money accumulation signals. Evidence of institutional buying or distribution patterns.'
			};
			return `
				<div class="compression-breakdown" style="display:flex;flex-direction:row;gap:8px;margin-top:6px;flex-wrap:wrap">
					<div class="source" style="flex:1;min-width:120px;position:relative" title="${tooltips['Compression']}"><div style="font-weight:700;cursor:help">Compression</div><div class="small">${compressionScore}/40</div><div class="progress"><i style="width:${compP}%;background:${getHeatMapColor((compressionScore/40)*100)}"></i></div><div class="small" style="margin-top:4px;font-size:10px">${sig.toFixed(1)}/wk | ${rsi} RSI&lt;20 | ${esc} escalations</div></div>
					<div class="source" style="flex:1;min-width:120px;position:relative" title="${tooltips['Intensification']}"><div style="font-weight:700;cursor:help">Intensification</div><div class="small">${intensScore}/20</div><div class="progress"><i style="width:${intensP}%;background:${getHeatMapColor((intensScore/20)*100)}"></i></div><div class="small" style="margin-top:4px;font-size:10px">${intensPattern}</div></div>
					<div class="source" style="flex:1;min-width:120px;position:relative" title="${tooltips['Volume death']}"><div style="font-weight:700;cursor:help">Volume death</div><div class="small">${vdScore}/15</div><div class="progress"><i style="width:${vdP}%;background:${getHeatMapColor((vdScore/15)*100)}"></i></div><div class="small" style="margin-top:4px;font-size:10px">${vdDesc}</div></div>
					<div class="source" style="flex:1;min-width:120px;position:relative" title="${tooltips['Pop potential']}"><div style="font-weight:700;cursor:help">Pop potential</div><div class="small">${popScore}/15</div><div class="progress"><i style="width:${popP}%;background:${getHeatMapColor((popScore/15)*100)}"></i></div><div class="small" style="margin-top:4px;font-size:10px">${pop.toFixed(0)}% best rally</div></div>
					<div class="source" style="flex:1;min-width:120px;position:relative" title="${tooltips['Accumulation']}"><div style="font-weight:700;cursor:help">Accumulation</div><div class="small">${accumScore}/10</div><div class="progress"><i style="width:${accumP}%;background:${getHeatMapColor((accumScore/10)*100)}"></i></div><div class="small" style="margin-top:4px;font-size:10px">${accumDesc}</div></div>
				</div>
			`
		}
		if(n === 'setup'){
			const ai = extra.ai_technical_score || 0;
			const rv = extra.relative_volume || 0;
			const rc = extra.rally_count || 0;
			const best = extra.best_historical_rally || 0;
			// Calculate scores based on APEX scoring breakdown
			const aiScore = Math.round((ai / 20) * 25); // AI is /20, but contributes /25 to final
			const rvScore = Math.round(Math.min(10, rv * 10)); // Relative volume /10
			const rcScore = Math.round(Math.min(15, (rc / 30) * 15)); // Rally count /15
			const bestScore = Math.round(Math.min(20, (Math.min(best, 1000) / 1000) * 20)); // Best rally /20
			const aiP = Math.round((aiScore / 25) * 100);
			const rvP = Math.round((rvScore / 10) * 100);
			const rcP = Math.round((rcScore / 15) * 100);
			const bestP = Math.round((bestScore / 20) * 100);
			const tooltips = {
				'AI Tech': 'Machine learning technical score. Higher = better technical setup patterns detected.',
				'Rel Vol': 'Volume relative to average. How much current volume exceeds the normal baseline.',
				'Rallies': 'Historical rally count. Number of significant price rallies in stock history.',
				'Best Rally': 'Best historical rally return. Highest percentage gain seen in stock history.'
			};
			return `
				<div class="component-tiles" style="display:flex;flex-direction:row;gap:4px;margin-top:6px;flex-wrap:nowrap">
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['AI Tech']}"><div style="font-weight:700;font-size:11px;cursor:help">AI Tech</div><div class="small" style="font-size:9px">${aiScore}/25</div><div class="progress"><i style="width:${aiP}%;background:${getHeatMapColor(aiP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['Rel Vol']}"><div style="font-weight:700;font-size:11px;cursor:help">Rel Vol</div><div class="small" style="font-size:9px">${rvScore}/10</div><div class="progress"><i style="width:${rvP}%;background:${getHeatMapColor(rvP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['Rallies']}"><div style="font-weight:700;font-size:11px;cursor:help">Rallies</div><div class="small" style="font-size:9px">${rcScore}/15</div><div class="progress"><i style="width:${rcP}%;background:${getHeatMapColor(rcP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['Best Rally']}"><div style="font-weight:700;font-size:11px;cursor:help">Best Rally</div><div class="small" style="font-size:9px">${bestScore}/20</div><div class="progress"><i style="width:${bestP}%;background:${getHeatMapColor(bestP)}"></i></div></div>
				</div>
			`
		}
		if(n === 'panic'){
			const pd = extra.price_destruction || 0;
			const vd = extra.volume_death || 0;
			const ss = extra.social_silence || 0;
			const ns = extra.news_sentiment || 0;
			const pdP = Math.max(0, Math.min(100, Math.round((pd / 40) * 100)));
			const vdP = Math.max(0, Math.min(100, Math.round((vd / 20) * 100)));
			const ssP = Math.max(0, Math.min(100, Math.round((ss / 20) * 100)));
			const nsP = Math.max(0, Math.min(100, Math.round((ns / 20) * 100)));
			const tooltips = {
				'Price': 'Price destruction score. Measures magnitude of the crash/drawdown.',
				'Volume': 'Volume death/surge. How abnormal is the trading volume during the move.',
				'Social': 'Social silence indicator. Lack of social discussion can signal fear/panic.',
				'News': 'News sentiment negativity. How negative are company announcements/news.'
			};
			return `
				<div class="panic-tiles" style="display:flex;flex-direction:row;gap:4px;margin-top:6px;flex-wrap:nowrap">
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['Price']}"><div style="font-weight:700;font-size:11px;cursor:help">Price</div><div class="small" style="font-size:9px">${pd.toFixed(1)}/40</div><div class="progress"><i style="width:${pdP}%;background:${getHeatMapColor(pdP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['Volume']}"><div style="font-weight:700;font-size:11px;cursor:help">Volume</div><div class="small" style="font-size:9px">${vd.toFixed(1)}/20</div><div class="progress"><i style="width:${vdP}%;background:${getHeatMapColor(vdP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['Social']}"><div style="font-weight:700;font-size:11px;cursor:help">Social</div><div class="small" style="font-size:9px">${ss.toFixed(1)}/20</div><div class="progress"><i style="width:${ssP}%;background:${getHeatMapColor(ssP)}"></i></div></div>
					<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips['News']}"><div style="font-weight:700;font-size:11px;cursor:help">News</div><div class="small" style="font-size:9px">${ns.toFixed(1)}/20</div><div class="progress"><i style="width:${nsP}%;background:${getHeatMapColor(nsP)}"></i></div></div>
				</div>
			`
		}
		if(n === 'trust'){
			// render the Trust source tiles (coverage + reliability)
			// Trust data comes from the data parameter: data.trust.coverage
			const cov = (data && data.trust && data.trust.coverage) || {};
			const tooltips = {
				RNS: 'Official regulatory announcements and company news. Coverage: how many RNS items tracked (50 = 100%). Reliability: confidence in data quality.',
				Social: 'Social media sentiment from trading communities. Coverage: number of posts analyzed (1000 = 100%). Reliability: based on volume and consistency.',
				Trends: 'Google Trends and web analysis data. Coverage: 100% if active data, 0% if unavailable. Reliability: 75% when present.',
				History: 'Historical price data for pattern analysis. Coverage: number of price bars (1000 = 100%). Reliability: 95% if >500 bars, 70% if <500.'
			};
			let out = '<div class="trust-tiles" style="display:flex;flex-direction:row;gap:4px;margin-top:6px;flex-wrap:nowrap">';
			for(const [k,v] of Object.entries(cov)){
				const pct = v.coverage || 0; const rel = Math.round((v.reliability||0)*100);
				out += `<div class="source" style="flex:1;min-width:40px;padding:6px" title="${tooltips[k] || 'Data source'}"><div style="font-weight:700;font-size:11px;line-height:1.2;cursor:help">${k}</div><div class="small" style="font-size:9px">${pct.toFixed(0)}%</div><div class="progress"><i style="width:${pct}%;background:${getHeatMapColor(pct)}"></i></div><div class="small" style="margin-top:4px;font-size:8px">${rel}/100</div></div>`;
			}
			out += '</div>';
			return out;
		}
		return '';
	}catch(e){console.warn('renderComponentTilesHTML failed',e); return ''}
}

// keep legacy compression wrapper for backward compatibility
function renderCompressionBreakdownHTML(extra){ return renderComponentTilesHTML('compression', extra, null) }
function renderError(err){
	try{
		const msg = (err && err.stack) ? err.stack : String(err);
		document.body.innerHTML = `<div style="padding:20px;background:#111;color:#f88;font-family:monospace"><h3>Script error</h3><pre>${msg.replace(/</g,'&lt;')}</pre></div>`;
	}catch(e){console.error('renderError failed',e)}
}
// global handlers to surface errors directly in the page
window.onerror = function(message, source, lineno, colno, error){
	try{ console.error('window.onerror',message,source,lineno,colno,error); renderError(error||message) }catch(e){console.error('onerror handler failed',e)};
	return true;
}
window.onunhandledrejection = function(ev){ try{ console.error('unhandledrejection',ev); renderError(ev.reason||ev) }catch(e){console.error('onunhandledrejection failed',e)} }
window.addEventListener('resize',()=>document.querySelectorAll('.spark').forEach(el=>{const d=el.__data__; if(d) drawSpark(el,d)}))
try{ load().catch(e=>{console.error('load failed',e); renderError(e)}) }catch(e){console.error('load throw',e); renderError(e) }