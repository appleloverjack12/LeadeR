import Parser from 'rss-parser';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

const parser = new Parser({ timeout: 10000 });

// ── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  gmailUser:    process.env.GMAIL_USER,
  gmailPass:    process.env.GMAIL_APP_PASSWORD,
  emailTo:      process.env.EMAIL_TO || process.env.GMAIL_USER,
};

// ── RSS SOURCES ───────────────────────────────────────────────────────────
// Targeted searches for buying signals in HR/SI/AT
const SOURCES = [
  // Croatia business news
  { url: 'https://news.google.com/rss/search?q=marketing+agencija+hrvatska+nova&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=event+management+croatia+new&hl=en&gl=HR&ceid=HR:en', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=otvaranje+tvrtka+hrvatska+2025&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=investicija+hrvatska+tvrtka+širenje&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=hotel+resort+otvaranje+hrvatska&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },
  { url: 'https://news.google.com/rss/search?q=konferencija+event+organizacija+hrvatska&hl=hr&gl=HR&ceid=HR:hr', region: 'HR' },

  // Slovenia business news
  { url: 'https://news.google.com/rss/search?q=marketing+agencija+slovenija+nova&hl=sl&gl=SI&ceid=SI:sl', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=event+management+slovenia+new&hl=en&gl=SI&ceid=SI:en', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=nova+podjetja+investicija+slovenija&hl=sl&gl=SI&ceid=SI:sl', region: 'SI' },
  { url: 'https://news.google.com/rss/search?q=odprtje+hotel+venue+slovenija&hl=sl&gl=SI&ceid=SI:sl', region: 'SI' },

  // Austria business news
  { url: 'https://news.google.com/rss/search?q=marketing+agentur+österreich+neu&hl=de&gl=AT&ceid=AT:de', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=event+management+austria+new+company&hl=en&gl=AT&ceid=AT:en', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=neue+firma+expansion+österreich+marketing&hl=de&gl=AT&ceid=AT:de', region: 'AT' },
  { url: 'https://news.google.com/rss/search?q=hotel+eröffnung+wien+graz&hl=de&gl=AT&ceid=AT:de', region: 'AT' },

  // Regional business portals
  { url: 'https://www.poslovni.hr/feed/', region: 'HR' },
  { url: 'https://lider.media/feed/', region: 'HR' },
];

const REGION_FLAG = { HR: '🇭🇷', SI: '🇸🇮', AT: '🇦🇹' };

// ── FETCH ALL FEEDS ───────────────────────────────────────────────────────
async function fetchAllFeeds() {
  const allItems = [];
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of (feed.items || [])) {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (pubDate < threeDaysAgo) continue; // only recent items
        allItems.push({
          title:   item.title || '',
          summary: item.contentSnippet || item.content || '',
          link:    item.link || '',
          pubDate: item.pubDate || '',
          region:  source.region,
        });
      }
    } catch (e) {
      console.log(`⚠ Feed failed: ${source.url} — ${e.message}`);
    }
  }

  // Deduplicate by title similarity
  const seen = new Set();
  return allItems.filter(item => {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── CLAUDE ANALYSIS ───────────────────────────────────────────────────────
async function analyzeWithClaude(items) {
  if (!items.length) return [];

  // Batch items to reduce API calls — send up to 20 at a time
  const batches = [];
  for (let i = 0; i < items.length; i += 20) {
    batches.push(items.slice(i, i + 20));
  }

  const leads = [];

  for (const batch of batches) {
    const itemsList = batch.map((item, i) =>
      `[${i}] ${REGION_FLAG[item.region]} ${item.region}\nTitle: ${item.title}\nSummary: ${item.summary.slice(0, 300)}\nURL: ${item.link}`
    ).join('\n\n---\n\n');

    const prompt = `You are a lead intelligence analyst for kajgod.agency, a marketing and event management agency operating in Croatia, Slovenia and Austria.

Analyze these news items and identify ONLY genuine business opportunities where kajgod.agency could realistically win new work. 

STRONG signals to flag:
- Company opening new office, branch, venue, hotel, restaurant, store in HR/SI/AT
- Company receiving investment or funding and likely expanding
- Company announcing a product launch, rebrand, or major campaign
- New event, conference, trade fair, or festival being organized
- Company hiring for marketing/events roles (they need help but don't have staff yet)
- Company that recently lost their marketing agency or is looking for one
- Startup or scale-up growing quickly in the region

IGNORE:
- Generic industry news with no specific company opportunity
- Political news
- Companies already with established large marketing teams
- News outside HR/SI/AT region
- Anything more than 3 days old

For each genuine opportunity, respond in this EXACT JSON format (array of objects):
{
  "index": <number from the list>,
  "company": "<company name>",
  "opportunity": "<one sentence: what is the specific opportunity>",
  "why_kajgod": "<one sentence: why this is relevant for a marketing/event agency>",
  "urgency": "high|medium|low",
  "linkedin_role": "<job title to search for on LinkedIn to find the right contact, e.g. 'CEO', 'Marketing Director', 'Head of Events'>",
  "linkedin_company": "<company name to search on LinkedIn>",
  "region": "<HR|SI|AT>"
}

Return ONLY a valid JSON array. If no genuine opportunities found, return [].
Do not include any text outside the JSON.

NEWS ITEMS:
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
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await response.json();
      const text = data.content?.[0]?.text || '[]';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      for (const lead of parsed) {
        const original = batch[lead.index];
        if (original) {
          leads.push({ ...lead, title: original.title, link: original.link, pubDate: original.pubDate });
        }
      }
    } catch (e) {
      console.log(`⚠ Claude batch failed: ${e.message}`);
    }
  }

  // Sort by urgency
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  return leads.sort((a, b) => (urgencyOrder[a.urgency] || 1) - (urgencyOrder[b.urgency] || 1));
}

// ── BUILD LINKEDIN URL ────────────────────────────────────────────────────
function linkedInSearchURL(company, role) {
  const q = encodeURIComponent(`${role} ${company}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}

// ── BUILD EMAIL HTML ──────────────────────────────────────────────────────
function buildEmail(leads, fetchedCount) {
  const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const urgencyColor = { high: '#FF3B5C', medium: '#FF8C00', low: '#00C896' };
  const urgencyLabel = { high: '🔴 HIGH', medium: '🟡 MEDIUM', low: '🟢 LOW' };

  const leadsHTML = leads.length === 0
    ? `<div style="text-align:center;padding:48px 24px;color:#888;font-size:14px">
        No high-signal opportunities found this cycle. Next scan in 3 days.
       </div>`
    : leads.map(lead => `
      <div style="background:white;border:1px solid #E8E8E0;border-radius:12px;padding:24px;margin-bottom:16px;border-left:4px solid ${urgencyColor[lead.urgency] || '#888'}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
          <div>
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${urgencyColor[lead.urgency]}">${urgencyLabel[lead.urgency]}</span>
            <span style="font-size:10px;color:#aaa;margin-left:10px">${REGION_FLAG[lead.region]} ${lead.region}</span>
          </div>
          <span style="font-size:11px;color:#aaa">${lead.pubDate ? new Date(lead.pubDate).toLocaleDateString('en-GB') : ''}</span>
        </div>

        <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#0A0A0A;letter-spacing:-0.5px;margin-bottom:6px">${lead.company}</div>
        <div style="font-size:13px;color:#333;margin-bottom:8px;line-height:1.5"><strong>Opportunity:</strong> ${lead.opportunity}</div>
        <div style="font-size:13px;color:#555;margin-bottom:16px;line-height:1.5"><strong>Why kajgod.:</strong> ${lead.why_kajgod}</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="${linkedInSearchURL(lead.linkedin_company, lead.linkedin_role)}"
             style="display:inline-block;background:#0A66C2;color:white;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:0.3px">
            🔍 Find ${lead.linkedin_role} on LinkedIn
          </a>
          ${lead.link ? `<a href="${lead.link}" style="display:inline-block;background:#F5F5F0;color:#0A0A0A;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid #E0E0D8">
            Read source →
          </a>` : ''}
        </div>
      </div>`).join('');

  const highCount   = leads.filter(l => l.urgency === 'high').length;
  const mediumCount = leads.filter(l => l.urgency === 'medium').length;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif">

<div style="max-width:640px;margin:0 auto;padding:32px 16px">

  <!-- Header -->
  <div style="background:#0A0A0A;border-radius:16px;padding:32px;margin-bottom:24px;position:relative;overflow:hidden">
    <div style="position:absolute;top:0;right:0;width:0;height:0;border-left:80px solid transparent;border-top:80px solid #FFE600;opacity:0.8"></div>
    <div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:white;letter-spacing:-1px;margin-bottom:4px">kajgod. <span style="color:#FFE600">Leads</span></div>
    <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:2px">Intelligence Digest · ${now}</div>
    <div style="display:flex;gap:20px;margin-top:20px">
      <div style="text-align:center">
        <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#FFE600">${leads.length}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">Opportunities</div>
      </div>
      <div style="text-align:center">
        <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#FF3B5C">${highCount}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">High Priority</div>
      </div>
      <div style="text-align:center">
        <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#FF8C00">${mediumCount}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">Medium Priority</div>
      </div>
      <div style="text-align:center">
        <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#aaa">${fetchedCount}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px">News Scanned</div>
      </div>
    </div>
  </div>

  <!-- Leads -->
  <div style="margin-bottom:24px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#888;margin-bottom:14px;display:flex;align-items:center;gap:8px">
      <div style="width:20px;height:2px;background:#FFE600"></div>
      Opportunities This Cycle
    </div>
    ${leadsHTML}
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:20px;font-size:11px;color:#aaa">
    kajgod. Lead Intelligence · Scans every 3 days · HR 🇭🇷 SI 🇸🇮 AT 🇦🇹<br/>
    Powered by Claude AI
  </div>

</div>
</body>
</html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────────────────
async function sendEmail(html, leadCount) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: CONFIG.gmailUser, pass: CONFIG.gmailPass },
  });

  const subject = leadCount > 0
    ? `🎯 ${leadCount} new leads · kajgod. Intelligence`
    : `📭 No new leads this cycle · kajgod. Intelligence`;

  await transporter.sendMail({
    from:    `"kajgod. Leads" <${CONFIG.gmailUser}>`,
    to:      CONFIG.EMAIL_TO || CONFIG.gmailUser,
    subject,
    html,
  });

  console.log(`✅ Email sent: "${subject}"`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 kajgod. Lead Intelligence — starting scan…');

  if (!CONFIG.anthropicKey) { console.error('❌ Missing ANTHROPIC_API_KEY'); process.exit(1); }
  if (!CONFIG.gmailUser)    { console.error('❌ Missing GMAIL_USER');         process.exit(1); }
  if (!CONFIG.gmailPass)    { console.error('❌ Missing GMAIL_APP_PASSWORD'); process.exit(1); }

  console.log('📡 Fetching RSS feeds…');
  const items = await fetchAllFeeds();
  console.log(`   Found ${items.length} recent items across all sources`);

  console.log('🧠 Analysing with Claude…');
  const leads = await analyzeWithClaude(items);
  console.log(`   Identified ${leads.length} genuine opportunities`);

  console.log('📧 Building and sending email…');
  const html = buildEmail(leads, items.length);
  await sendEmail(html, leads.length);

  console.log('✅ Done.');
}

main().catch(err => { console.error('❌ Fatal error:', err); process.exit(1); });
