import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// ── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  serperKey:    process.env.SERPER_API_KEY,
  gmailUser:    process.env.GMAIL_USER,
  gmailPass:    process.env.GMAIL_APP_PASSWORD,
  emailTo:      process.env.EMAIL_TO || process.env.GMAIL_USER,
  minLeads:     3, // only send email if at least this many leads found
};

// ── MEMORY ────────────────────────────────────────────────────────────────
const MEMORY_FILE = 'memory.json';

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      return new Set(data.seen || []);
    }
  } catch(e) { console.log('⚠ Could not load memory, starting fresh'); }
  return new Set();
}

function saveMemory(seen) {
  try {
    // Keep only last 500 companies to avoid file bloat
    const arr = [...seen].slice(-500);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ seen: arr, updated: new Date().toISOString() }, null, 2));
    console.log(`   💾 Memory saved — ${arr.length} companies tracked`);
  } catch(e) { console.log('⚠ Could not save memory:', e.message); }
}

function companyKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// ── SERPER SEARCH ─────────────────────────────────────────────────────────
const QUERIES = [
  // Croatia — industrial & tech buying signals
  'hrvatska industrija tvornica investicija otvaranje 2025 2026',
  'croatia manufacturing company expansion investment new facility',
  'croatia automotive supplier new plant contract 2025 2026',
  'croatia tech startup funding round investment',
  'croatia engineering firm won contract expansion',
  'zagreb nova tvrtka poslovni investicija rast',
  'hrvatska strojarstvo novi pogon projekt otvaranje',
  'croatia B2B trade fair exhibition industrial 2026',
  'croatia industrial company hiring marketing communications',

  // Slovenia — industrial & tech
  'slovenija industrija tovarna investicija 2025 2026',
  'slovenia manufacturing automotive company expansion',
  'slovenia tech startup funding growth new office',
  'slovenia engineering firm new contract facility',
  'ljubljana nova podjetja investicija rast',

  // Austria — industrial & tech
  'österreich industrie fabrik investition eröffnung 2025 2026',
  'austria manufacturing tech company expansion growth',
  'austria automotive supplier new facility contract',
  'austria engineering startup funding investment',
  'wien graz industrie messe neue firma',
];

async function searchSerper(query) {
  try {
    const response = await fetch('https://google.serper.dev/news', {
      method: 'POST',
      headers: {
        'X-API-KEY': CONFIG.serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 10, gl: 'hr', hl: 'en' }),
    });
    const data = await response.json();
    return (data.news || []).map(item => ({
      title:   item.title || '',
      summary: item.snippet || '',
      link:    item.link || '',
      pubDate: item.date || '',
      source:  item.source || '',
      query,
    }));
  } catch(e) {
    console.log(`⚠ Serper search failed for "${query}": ${e.message}`);
    return [];
  }
}

async function fetchAllArticles() {
  console.log(`   Running ${QUERIES.length} targeted searches…`);
  const allItems = [];

  for (const query of QUERIES) {
    const results = await searchSerper(query);
    allItems.push(...results);
    // Small delay to be nice to the API
    await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicate by URL and title
  const seenLinks = new Set();
  const seenTitles = new Set();
  return allItems.filter(item => {
    const linkKey = item.link?.slice(0, 80);
    const titleKey = item.title?.toLowerCase().slice(0, 60);
    if (seenLinks.has(linkKey) || seenTitles.has(titleKey)) return false;
    seenLinks.add(linkKey);
    seenTitles.add(titleKey);
    return true;
  });
}

// ── CLAUDE ANALYSIS ───────────────────────────────────────────────────────
async function analyzeWithClaude(items, seenCompanies) {
  if (!items.length) return [];

  const batches = [];
  for (let i = 0; i < items.length; i += 20) batches.push(items.slice(i, i + 20));
  const allLeads = [];

  for (const batch of batches) {
    const itemsList = batch.map((item, i) =>
      `[${i}]\nTitle: ${item.title}\nSummary: ${item.summary}\nSource: ${item.source}\nURL: ${item.link}`
    ).join('\n\n---\n\n');

    const prompt = `You are a lead intelligence analyst for kajgod.agency — a marketing and event management agency run by a mechanical engineer, specialising in INDUSTRIAL, AUTOMOTIVE and TECH companies in Croatia, Slovenia and Austria.

kajgod.agency's ideal clients:
- Manufacturing and industrial companies (machinery, metalworking, plastics, chemicals, electronics)
- Automotive suppliers, dealers, distributors
- Engineering companies (mechanical, electrical, civil, construction)
- B2B tech companies targeting industrial or enterprise clients
- Companies organising industrial trade fairs, B2B exhibitions, technical conferences
- Energy, renewables, logistics companies expanding in HR/SI/AT

What kajgod.agency offers:
- Brand positioning and marketing strategy
- Trade fair presence and event management
- B2B content marketing and LinkedIn campaigns
- Product launch campaigns

STRONG buying signals to flag:
- Company opening new facility, plant, office or expanding capacity in HR/SI/AT
- Automotive company or supplier entering or growing in the region
- Tech or engineering firm receiving investment or announcing growth
- Company launching new product line, rebranding or entering new market
- Industrial trade fair or B2B conference being organised in the region
- Company hiring for marketing, comms, sales or PR roles (they need help)
- Engineering or manufacturing firm that won a major contract or partnership

SKIP:
- Consumer lifestyle (fashion, food, entertainment, hospitality, tourism)
- Politics, crime, accidents, sports
- Vague articles with no identifiable company
- Companies clearly outside HR/SI/AT with no regional connection

IMPORTANT: Each company should appear ONLY ONCE. Pick the most relevant article per company.

For each genuine opportunity return this JSON:
{
  "index": <article number>,
  "company": "<exact company name>",
  "opportunity": "<one sentence: what specifically happened>",
  "why_kajgod": "<one sentence: exactly how kajgod.agency can help>",
  "urgency": "high|medium|low",
  "linkedin_role": "<best person to contact: CEO, Marketing Manager, Head of Sales, Communications Director, Founder>",
  "linkedin_company": "<company name>",
  "region": "<HR|SI|AT>",
  "sector": "<Industrial|Automotive|Tech|Engineering|Energy|Logistics|Other>"
}

Urgency guide:
- high = company just got funding / opened something / won a major contract — act within a week
- medium = expanding or hiring — reach out within a month
- low = general growth signal — worth monitoring

Return ONLY a valid JSON array. No text outside JSON. If nothing genuinely fits, return [].

NEWS ARTICLES:
${itemsList}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CONFIG.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await response.json();
      if (data.error) { console.log(`⚠ Claude error: ${JSON.stringify(data.error)}`); continue; }

      const text = data.content?.[0]?.text || '[]';
      console.log(`   Claude preview: ${text.slice(0, 100)}`);
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      for (const lead of parsed) {
        const original = batch[lead.index];
        if (!original) continue;
        const key = companyKey(lead.company);
        // Skip if already seen in memory OR already in this batch
        if (seenCompanies.has(key)) {
          console.log(`   ⏭ Skipping ${lead.company} (already in memory)`);
          continue;
        }
        allLeads.push({ ...lead, link: original.link, pubDate: original.pubDate, source: original.source });
      }
    } catch(e) { console.log(`⚠ Claude batch failed: ${e.message}`); }
  }

  // Deduplicate by company name across batches
  const seenInRun = new Set();
  const unique = allLeads.filter(l => {
    const key = companyKey(l.company);
    if (seenInRun.has(key)) return false;
    seenInRun.add(key);
    return true;
  });

  const order = { high: 0, medium: 1, low: 2 };
  return unique.sort((a, b) => (order[a.urgency] || 1) - (order[b.urgency] || 1));
}

// ── LINKEDIN URL ──────────────────────────────────────────────────────────
function linkedInURL(company, role) {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${role} ${company}`)}&origin=GLOBAL_SEARCH_HEADER`;
}

// ── SECTOR & URGENCY COLORS ───────────────────────────────────────────────
const SECTOR_COLOR = { Industrial:'#FF6B2B', Automotive:'#1877F2', Tech:'#8B5CF6', Engineering:'#FF8C00', Energy:'#00C896', Logistics:'#0A66C2', Other:'#888' };
const U_COLOR = { high:'#FF3B5C', medium:'#FF8C00', low:'#00C896' };
const U_LABEL = { high:'🔴 HIGH', medium:'🟡 MEDIUM', low:'🟢 LOW' };
const REGION_FLAG = { HR:'🇭🇷', SI:'🇸🇮', AT:'🇦🇹' };

// ── BUILD EMAIL ───────────────────────────────────────────────────────────
function buildEmail(leads, scannedCount) {
  const now = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' });
  const highCount   = leads.filter(l => l.urgency === 'high').length;
  const mediumCount = leads.filter(l => l.urgency === 'medium').length;

  const sectorCounts = {};
  leads.forEach(l => { sectorCounts[l.sector||'Other'] = (sectorCounts[l.sector||'Other']||0)+1; });
  const sectorBadges = Object.entries(sectorCounts)
    .map(([s,n]) => `<span style="font-size:11px;background:${SECTOR_COLOR[s]||'#888'}20;color:${SECTOR_COLOR[s]||'#888'};border:1px solid ${SECTOR_COLOR[s]||'#888'}40;padding:3px 10px;border-radius:99px;font-weight:700">${s} · ${n}</span>`)
    .join(' ');

  const leadsHTML = leads.map(l => `
    <div style="background:white;border:1px solid #E0E0E0;border-radius:12px;padding:22px;margin-bottom:14px;border-left:4px solid ${U_COLOR[l.urgency]||'#888'}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${U_COLOR[l.urgency]}">${U_LABEL[l.urgency]}</span>
        <span style="font-size:11px;font-weight:700;color:white;background:${SECTOR_COLOR[l.sector]||'#888'};padding:2px 9px;border-radius:4px">${l.sector||'Other'}</span>
        <span style="font-size:10px;color:#aaa">${REGION_FLAG[l.region]||''} ${l.region||''}</span>
        ${l.source ? `<span style="font-size:10px;color:#bbb">· ${l.source}</span>` : ''}
        ${l.pubDate ? `<span style="font-size:10px;color:#bbb;margin-left:auto">${l.pubDate}</span>` : ''}
      </div>
      <div style="font-size:20px;font-weight:800;color:#0A0A0A;letter-spacing:-0.5px;margin-bottom:8px">${l.company}</div>
      <div style="font-size:13px;color:#444;margin-bottom:8px;line-height:1.6"><span style="font-weight:700;color:#0A0A0A">Signal: </span>${l.opportunity}</div>
      <div style="font-size:13px;color:#1a56c4;margin-bottom:18px;line-height:1.6;background:#EEF4FF;padding:10px 14px;border-radius:8px;border-left:3px solid #1877F2"><span style="font-weight:700">💡 Angle: </span>${l.why_kajgod}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="${linkedInURL(l.linkedin_company, l.linkedin_role)}" style="display:inline-flex;align-items:center;gap:6px;background:#0A66C2;color:white;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700">🔍 Find ${l.linkedin_role}</a>
        ${l.link ? `<a href="${l.link}" style="display:inline-flex;align-items:center;gap:6px;background:#F5F5F2;color:#333;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid #DDD">📰 Read article →</a>` : ''}
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#EBEBEB;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
<div style="max-width:620px;margin:0 auto;padding:28px 16px">

  <div style="background:#0A0A0A;border-radius:16px;overflow:hidden;margin-bottom:12px">
    <div style="padding:28px 28px 0;position:relative">
      <div style="position:absolute;top:0;right:0;width:0;height:0;border-left:120px solid transparent;border-top:120px solid #FFE600;opacity:0.9"></div>
      <div style="position:relative;z-index:1">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:#555;margin-bottom:6px">Lead Intelligence</div>
        <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:white;letter-spacing:-1px;line-height:1.1;margin-bottom:4px">kajgod. <span style="color:#FFE600">Leads</span></div>
        <div style="font-size:12px;color:#555;margin-bottom:20px">Industrial & Tech · ${now}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding:0 12px">
      ${[['#FFE600',leads.length,'Leads'],['#FF3B5C',highCount,'High'],['#FF8C00',mediumCount,'Medium'],['#777',scannedCount,'Scanned']]
        .map(([c,v,l]) => `<div style="padding:16px 8px"><div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:${c};line-height:1">${v}</div><div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-top:3px">${l}</div></div>`).join('')}
    </div>
    ${leads.length > 0 ? `<div style="padding:0 20px 20px;display:flex;gap:6px;flex-wrap:wrap">${sectorBadges}</div>` : '<div style="padding-bottom:20px"></div>'}
  </div>

  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999;margin-bottom:12px;display:flex;align-items:center;gap:8px">
    <div style="width:16px;height:2px;background:#FFE600;border-radius:2px"></div>
    Opportunities This Cycle
  </div>

  ${leadsHTML}

  <div style="text-align:center;padding:24px 0 8px;font-size:11px;color:#AAA;line-height:1.8">
    kajgod. Lead Intelligence · Industrial & Tech · HR 🇭🇷 SI 🇸🇮 AT 🇦🇹<br/>
    Powered by Claude Sonnet + Serper · Scans every 3 days
  </div>
</div></body></html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────────────────
async function sendEmail(html, leadCount) {
  const transporter = nodemailer.createTransport({ service:'gmail', auth:{ user:CONFIG.gmailUser, pass:CONFIG.gmailPass } });
  const subject = `⚙️ ${leadCount} industrial leads · kajgod. Intelligence`;
  await transporter.sendMail({ from:`"kajgod. Leads" <${CONFIG.gmailUser}>`, to:CONFIG.emailTo, subject, html });
  console.log(`✅ Email sent: "${subject}"`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('⚙️  kajgod. Industrial Lead Intelligence — starting…');
  if (!CONFIG.anthropicKey) { console.error('❌ Missing ANTHROPIC_API_KEY'); process.exit(1); }
  if (!CONFIG.serperKey)    { console.error('❌ Missing SERPER_API_KEY');    process.exit(1); }
  if (!CONFIG.gmailUser)    { console.error('❌ Missing GMAIL_USER');         process.exit(1); }
  if (!CONFIG.gmailPass)    { console.error('❌ Missing GMAIL_APP_PASSWORD'); process.exit(1); }

  // Load memory
  const seenCompanies = loadMemory();
  console.log(`📋 Memory loaded — ${seenCompanies.size} companies already seen`);

  // Search
  console.log('🔍 Searching via Serper…');
  const articles = await fetchAllArticles();
  console.log(`   Found ${articles.length} unique articles`);

  // Analyse
  console.log('🧠 Analysing with Claude Sonnet…');
  const leads = await analyzeWithClaude(articles, seenCompanies);
  console.log(`   Found ${leads.length} new unique leads`);

  // Check minimum threshold
  if (leads.length < CONFIG.minLeads) {
    console.log(`📭 Only ${leads.length} leads found (minimum is ${CONFIG.minLeads}) — skipping email this cycle`);
    // Still save memory even if we skip
    leads.forEach(l => seenCompanies.add(companyKey(l.company)));
    saveMemory(seenCompanies);
    return;
  }

  // Update memory with new leads
  leads.forEach(l => seenCompanies.add(companyKey(l.company)));
  saveMemory(seenCompanies);

  // Send
  console.log('📧 Sending email…');
  const html = buildEmail(leads, articles.length);
  await sendEmail(html, leads.length);

  console.log('✅ Done.');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
