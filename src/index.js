import Parser from 'rss-parser';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

const parser = new Parser({ timeout: 10000 });

const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  gmailUser:    process.env.GMAIL_USER,
  gmailPass:    process.env.GMAIL_APP_PASSWORD,
  emailTo:      process.env.EMAIL_TO || process.env.GMAIL_USER,
};

const SOURCES = [
  { url: 'https://news.google.com/rss/search?q=hrvatska+industrija+tvornica+investicija&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=hrvatska+tehnologija+startup+rast&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=croatia+manufacturing+factory+investment+2026&hl=en&gl=HR&ceid=HR:en', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=croatia+automotive+industry+supplier&hl=en&gl=HR&ceid=HR:en', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=croatia+tech+company+expansion+funding&hl=en&gl=HR&ceid=HR:en', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=croatia+engineering+firm+new+contract&hl=en&gl=HR&ceid=HR:en', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=hrvatska+strojarstvo+novi+pogon+projekt&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=croatia+B2B+trade+fair+exhibition+2026&hl=en&gl=HR&ceid=HR:en', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=slovenija+industrija+tovarna+investicija&hl=sl&gl=SI&ceid=SI:sl', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=slovenia+manufacturing+automotive+expansion&hl=en&gl=SI&ceid=SI:en', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=slovenia+tech+startup+funding+growth&hl=en&gl=SI&ceid=SI:en', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=slovenija+tehnologija+podjetje+rast&hl=sl&gl=SI&ceid=SI:sl', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=slovenia+engineering+industry+new+facility&hl=en&gl=SI&ceid=SI:en', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=slovenia+B2B+trade+show+industry+2026&hl=en&gl=SI&ceid=SI:en', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=österreich+industrie+fabrik+investition+2026&hl=de&gl=AT&ceid=AT:de', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=österreich+automotive+zulieferer+expansion&hl=de&gl=AT&ceid=AT:de', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=austria+manufacturing+tech+company+growth&hl=en&gl=AT&ceid=AT:en', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=austria+engineering+startup+funding&hl=en&gl=AT&ceid=AT:en', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=wien+graz+industrie+messe+fachmesse+2026&hl=de&gl=AT&ceid=AT:de', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=austria+B2B+industrial+trade+fair+2026&hl=en&gl=AT&ceid=AT:en', region: 'AT' },
  { url: 'https://www.poslovni.hr/feed/', region: 'HR' },
  { url: 'https://lider.media/feed/', region: 'HR' },
  { url: 'https://www.tportal.hr/biznis/rss', region: 'HR' },
  { url: 'https://www.vecernji.hr/biznis/rss', region: 'HR' },
];

const REGION_FLAG = { HR: '🇭🇷', SI: '🇸🇮', AT: '🇦🇹' };

// ── ONLY KEEP DIRECT ARTICLE LINKS ────────────────────────────────────────
function isDirectLink(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return !u.hostname.includes('google.com');
  } catch { return false; }
}

async function fetchAllFeeds() {
  const allItems = [];
  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;

  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of (feed.items || [])) {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (pubDate < fiveDaysAgo) continue;
        allItems.push({
          title:   item.title || '',
          summary: item.contentSnippet || item.content || '',
          link:    isDirectLink(item.link) ? item.link : '',
          pubDate: item.pubDate || '',
          region:  source.region,
        });
      }
    } catch (e) {
      console.log(`⚠ Feed failed: ${source.url} — ${e.message}`);
    }
  }

  const seen = new Set();
  return allItems.filter(item => {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function analyzeWithClaude(items) {
  if (!items.length) return [];

  const batches = [];
  for (let i = 0; i < items.length; i += 20) batches.push(items.slice(i, i + 20));
  const allLeads = [];

  for (const batch of batches) {
    const itemsList = batch.map((item, i) =>
      `[${i}] ${REGION_FLAG[item.region]} ${item.region}\nTitle: ${item.title}\nSummary: ${item.summary.slice(0, 300)}\nURL: ${item.link}`
    ).join('\n\n---\n\n');

    const prompt = `You are a lead intelligence analyst for kajgod.agency. The agency is run by a mechanical engineer and specialises in marketing and event management for INDUSTRIAL, AUTOMOTIVE and TECH companies in Croatia, Slovenia and Austria.

Their ideal clients are:
- Manufacturing and industrial companies (machinery, metalworking, plastics, chemicals, electronics production)
- Automotive suppliers, dealers, distributors or related firms
- Engineering companies (mechanical, electrical, civil, construction)
- B2B tech companies and software firms targeting industrial or enterprise clients
- Companies organising or attending industrial trade fairs, B2B exhibitions, technical conferences
- Energy, renewables, utilities companies expanding in the region
- Logistics, supply chain or warehousing companies growing in the region

kajgod.agency can help these companies with:
- Brand positioning and marketing strategy
- Trade fair presence and event management
- B2B content marketing and communications
- Product launch campaigns
- LinkedIn and digital marketing for industrial audiences

FLAG these buying signals — be generous:
- Industrial or manufacturing company opening new facility, plant, office or expanding capacity in HR/SI/AT
- Automotive company or supplier entering or expanding in the region
- Tech or engineering firm receiving investment or announcing growth
- Company announcing a new product line, entering a new market, or undergoing a rebrand
- Industrial trade fair, B2B conference or technical exhibition being organised in the region
- Company hiring for marketing, communications or sales roles (signals they need external help)
- Startup in industrial tech, cleantech, medtech or enterprise software growing in the region
- Any engineering or manufacturing firm that won a major contract or partnership

IMPORTANT: If the same company appears in multiple articles, include it ONLY ONCE using the most relevant article.

SKIP:
- Pure consumer lifestyle brands (fashion, food, entertainment, tourism)
- Political news with no business opportunity
- Crime, accidents, sports
- Vague articles with no identifiable company name

For each opportunity respond in this EXACT JSON format:
{
  "index": <number from the list>,
  "company": "<company name>",
  "opportunity": "<one sentence: the specific business trigger>",
  "why_kajgod": "<one sentence: how kajgod.agency can specifically help this company>",
  "urgency": "high|medium|low",
  "linkedin_role": "<best job title to contact>",
  "linkedin_company": "<company name for LinkedIn search>",
  "region": "<HR|SI|AT>",
  "sector": "<Industrial|Automotive|Tech|Engineering|Energy|Logistics|Other>"
}

Return ONLY a valid JSON array. If nothing fits, return [].
No text outside the JSON.

NEWS ITEMS:
${itemsList}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await response.json();
      if (data.error) { console.log(`⚠ Claude API error: ${JSON.stringify(data.error)}`); continue; }
      const text = data.content?.[0]?.text || '[]';
      console.log(`   Claude preview: ${text.slice(0, 120)}`);
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      for (const lead of parsed) {
        const original = batch[lead.index];
        if (original) allLeads.push({ ...lead, title: original.title, link: original.link, pubDate: original.pubDate });
      }
    } catch (e) { console.log(`⚠ Claude batch failed: ${e.message}`); }
  }

  // Deduplicate by company name across batches
  const seenCompanies = new Set();
  const uniqueLeads = allLeads.filter(l => {
    const key = l.company.toLowerCase().trim();
    if (seenCompanies.has(key)) return false;
    seenCompanies.add(key);
    return true;
  });

  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  return uniqueLeads.sort((a, b) => (urgencyOrder[a.urgency] || 1) - (urgencyOrder[b.urgency] || 1));
}

function linkedInSearchURL(company, role) {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${role} ${company}`)}&origin=GLOBAL_SEARCH_HEADER`;
}

const SECTOR_COLOR = {
  Industrial:  '#FF6B2B',
  Automotive:  '#1877F2',
  Tech:        '#8B5CF6',
  Engineering: '#FF8C00',
  Energy:      '#00C896',
  Logistics:   '#0A66C2',
  Other:       '#888',
};

function buildEmail(leads, fetchedCount) {
  const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const uColor = { high: '#FF3B5C', medium: '#FF8C00', low: '#00C896' };
  const uLabel = { high: '🔴 HIGH', medium: '🟡 MEDIUM', low: '🟢 LOW' };

  const highCount   = leads.filter(l => l.urgency === 'high').length;
  const mediumCount = leads.filter(l => l.urgency === 'medium').length;

  const sectorCounts = {};
  leads.forEach(l => { sectorCounts[l.sector || 'Other'] = (sectorCounts[l.sector || 'Other'] || 0) + 1; });
  const sectorBadges = Object.entries(sectorCounts)
    .map(([s, n]) => `<span style="font-size:11px;background:${SECTOR_COLOR[s]||'#888'}20;color:${SECTOR_COLOR[s]||'#888'};border:1px solid ${SECTOR_COLOR[s]||'#888'}40;padding:3px 10px;border-radius:99px;font-weight:700">${s} · ${n}</span>`)
    .join(' ');

  const leadsHTML = leads.length === 0
    ? `<div style="text-align:center;padding:48px 24px;color:#888;font-size:14px">No industrial leads found this cycle. Next scan in 3 days.</div>`
    : leads.map(lead => {
        const sc = SECTOR_COLOR[lead.sector] || '#888';
        return `
        <div style="background:white;border:1px solid #E0E0E0;border-radius:12px;padding:22px;margin-bottom:14px;border-left:4px solid ${uColor[lead.urgency]||'#888'}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;flex-wrap:wrap">
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${uColor[lead.urgency]}">${uLabel[lead.urgency]}</span>
            <span style="font-size:11px;font-weight:700;color:white;background:${sc};padding:2px 9px;border-radius:4px">${lead.sector||'Other'}</span>
            <span style="font-size:10px;color:#aaa">${REGION_FLAG[lead.region]||''} ${lead.region}</span>
            ${lead.pubDate ? `<span style="font-size:10px;color:#bbb;margin-left:auto">${new Date(lead.pubDate).toLocaleDateString('en-GB')}</span>` : ''}
          </div>
          <div style="font-size:20px;font-weight:800;color:#0A0A0A;letter-spacing:-0.5px;margin-bottom:8px">${lead.company}</div>
          <div style="font-size:13px;color:#444;margin-bottom:8px;line-height:1.6"><span style="font-weight:700;color:#0A0A0A">Signal: </span>${lead.opportunity}</div>
          <div style="font-size:13px;color:#1a56c4;margin-bottom:18px;line-height:1.6;background:#EEF4FF;padding:10px 14px;border-radius:8px;border-left:3px solid #1877F2"><span style="font-weight:700">💡 Angle: </span>${lead.why_kajgod}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="${linkedInSearchURL(lead.linkedin_company, lead.linkedin_role)}"
               style="display:inline-flex;align-items:center;gap:6px;background:#0A66C2;color:white;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700">
              🔍 Find ${lead.linkedin_role}
            </a>
            ${lead.link ? `<a href="${lead.link}" style="display:inline-flex;align-items:center;gap:6px;background:#F5F5F2;color:#333;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid #DDD">📰 Read article →</a>` : ''}
          </div>
        </div>`;
      }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#EBEBEB;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif">
<div style="max-width:620px;margin:0 auto;padding:28px 16px">

  <div style="background:#0A0A0A;border-radius:16px;overflow:hidden;margin-bottom:12px">
    <div style="padding:28px 28px 0;position:relative">
      <div style="position:absolute;top:0;right:0;width:0;height:0;border-left:120px solid transparent;border-top:120px solid #FFE600;opacity:0.9"></div>
      <div style="position:relative;z-index:1">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:#555;margin-bottom:6px">Lead Intelligence</div>
        <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:white;letter-spacing:-1px;line-height:1.1;margin-bottom:4px">kajgod. <span style="color:#FFE600">Leads</span></div>
        <div style="font-size:12px;color:#555;letter-spacing:0.5px;margin-bottom:20px">Industrial & Tech · ${now}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding:0 12px">
      ${[['#FFE600',leads.length,'Leads'],['#FF3B5C',highCount,'High'],['#FF8C00',mediumCount,'Medium'],['#777',fetchedCount,'Scanned']]
        .map(([color,val,label]) => `
        <div style="padding:16px 8px">
          <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:${color};line-height:1">${val}</div>
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-top:3px">${label}</div>
        </div>`).join('')}
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
    Scans every 3 days · Powered by Claude AI
  </div>
</div>
</body>
</html>`;
}

async function sendEmail(html, leadCount) {
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: CONFIG.gmailUser, pass: CONFIG.gmailPass } });
  const subject = leadCount > 0 ? `⚙️ ${leadCount} industrial leads · kajgod. Intelligence` : `📭 No leads this cycle · kajgod. Intelligence`;
  await transporter.sendMail({ from: `"kajgod. Leads" <${CONFIG.gmailUser}>`, to: CONFIG.emailTo, subject, html });
  console.log(`✅ Email sent: "${subject}"`);
}

async function main() {
  console.log('⚙️  kajgod. Industrial Lead Intelligence — starting scan…');
  if (!CONFIG.anthropicKey) { console.error('❌ Missing ANTHROPIC_API_KEY'); process.exit(1); }
  if (!CONFIG.gmailUser)    { console.error('❌ Missing GMAIL_USER');         process.exit(1); }
  if (!CONFIG.gmailPass)    { console.error('❌ Missing GMAIL_APP_PASSWORD'); process.exit(1); }
  console.log('📡 Fetching RSS feeds…');
  const items = await fetchAllFeeds();
  console.log(`   Found ${items.length} recent items`);
  console.log('🧠 Analysing with Claude Sonnet…');
  const leads = await analyzeWithClaude(items);
  console.log(`   Identified ${leads.length} unique leads`);
  console.log('📧 Sending email digest…');
  const html = buildEmail(leads, items.length);
  await sendEmail(html, leads.length);
  console.log('✅ Done.');
}

main().catch(err => { console.error('❌ Fatal error:', err); process.exit(1); });
