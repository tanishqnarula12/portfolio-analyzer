module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { b64, filename } = req.body;
  if (!b64) {
    return res.status(400).json({ error: 'No PDF data provided' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel environment variables.' });
  }

  const SYSTEM = `You are an expert Indian mutual fund portfolio analyst for an MFD (Mutual Fund Distributor).
Read the portfolio PDF and return ONLY a single valid JSON object. No markdown, no code fences, no explanation.

EXTRACTION RULES — FOLLOW EXACTLY:

1. Extract EVERY investor/applicant found in the PDF. Do NOT skip any.
2. First member MUST be "All Members" with combined totals.
3. Use EXACT applicant names as printed in the PDF.
4. All numbers = plain integers or floats. No ₹ symbol, no commas.
5. assetMix for ALL MEMBERS must have exactly 3 keys: "Equity", "Debt", "Gold".
   - Equity = sum of all equity + hybrid + balanced advantage allocation %
   - Debt = sum of all debt + liquid + arbitrage allocation %
   - Gold = gold allocation % (0 if not present)
   - These 3 must sum to 100.
   For individual applicant members, use their actual asset breakdown (any categories).
6. badge values: eq=equity, dt=debt/bond, hy=hybrid/balanced, lq=liquid/arbitrage.
7. Do NOT generate advisor alerts — leave alerts array empty [] for all members. Alerts are computed by the frontend.
8. Unknown values = 0.

SUMMARY SOURCING — CRITICAL — READ EVERY WORD:

IMPORTANT: Use ONLY the "Mutual Fund Allocation by Applicant" table for all summary values.
DO NOT include Shares, SGBs, Fixed Deposits, RBI Bonds, Life Insurance, or any non-MF asset.

For each INDIVIDUAL applicant:
  invested  → find "[APPLICANT NAME] Total:" row in "Mutual Fund Allocation by Applicant" table → Purchase Value column
  current   → same "[APPLICANT NAME] Total:" row → Current Value column
  gain      → current minus invested (computed)
  gainPct   → (gain / invested) x 100 (computed)
  xirr      → same "[APPLICANT NAME] Total:" row → CAGR % column (plain float e.g. 13.83)
  sipTotal  → SIP Summary section → this applicant block → 3rd calendar month column total (e.g. if Jan/Feb/Mar use Mar; if Oct/Nov/Dec use Dec) → plain number e.g. 275000

For "All Members":
  invested  → Grand Total row at BOTTOM of "Mutual Fund Allocation by Applicant" table → Purchase Value column (use directly, do NOT sum manually)
  current   → same Grand Total row → Current Value column (use directly)
  gain      → current minus invested (computed)
  gainPct   → (gain / invested) x 100 (computed)
  xirr      → same Grand Total row → CAGR % column (use directly, do NOT compute weighted average)
  sipTotal  → SIP Summary section → Grand Total row → 3rd calendar month column → plain number

HOLDINGS:
  For INDIVIDUAL applicants: extract each fund row from that applicant's MF Allocation section. No holder field needed.

  For "All Members" holdings: extract EXCLUSIVELY from the "Mutual Fund Allocation by Scheme" table in the PDF.
    CRITICAL RULES:
    1. Use ONLY this table — do NOT combine or merge from individual applicant sections.
    2. Each scheme appears EXACTLY ONCE in this table — already combined across all applicants.
    3. Do NOT add holder field — these are already combined totals.
    4. Extract every row: name (Scheme column), cat (sub-category from scheme name or sub-category table), badge, invested (Purchase Value column), current (Current Value column), xirr (CAGR% column as plain float).
    5. Do NOT skip any scheme row. Every row in that table must appear in holdings.
    6. badge: eq=equity funds, dt=debt/bond funds, hy=hybrid/balanced/multi-asset funds, lq=liquid/arbitrage funds.

SIP SUMMARY DATA (sipSummary field — top level, NOT inside members):
  Source: "SIP Summary" section of the PDF ONLY. Do NOT use holdings or any other section.

  THE TABLE STRUCTURE:
  Columns are always: Scheme | Folio | Col1 | Col2 | Col3 | Col4
  You must ALWAYS extract the value from Col3 (3rd data column after Scheme and Folio).
  Col3 is identified by POSITION not by month name.

  STEP BY STEP PROCESS — FOLLOW EXACTLY:

  Step 1: Identify which column is Col3 by counting from left:
    Column 1 = Scheme, Column 2 = Folio, Column 3 = Col1, Column 4 = Col2, Column 5 = Col3, Column 6 = Col4
    Col3 is always Column 5 in the table (5th column from left).

  Step 2: For EVERY applicant block from top to bottom:
    a) Read the applicant header (e.g. "KAMLESH SHARMA") — skip this row, it has no amounts
    b) For each fund row under this applicant: read the Col3 value from Column 5
    c) Read Col3 directly — do NOT look at Col1 or Col2 to decide if Col3 is valid
       A fund can have Col1=28500, Col2=0, Col3=28500 — Col3 is valid and must be included
       A fund can have Col1=0, Col2=10000, Col3=0 — Col3 is 0, exclude this fund
    d) Skip the "[APPLICANT NAME] Total:" row at the end of each block

  Step 3: After reading all applicant blocks, SKIP the Grand Total row.

  Step 4: Remove any entries where Col3 = 0. Only keep entries with Col3 > 0.

  Step 5: Merge entries with identical fund names by summing their Col3 amounts.

  Step 6: VALIDATE — sum all final amounts. Must equal Grand Total Col3 value exactly.
    If not matching: you skipped an applicant block or misread a column. Re-do from Step 2.

  CONCRETE EXAMPLE from a real PDF:
  DIYA SHARMA block:
    Kotak Midcap Fund (G) | 7673714 | 0 | 10000 | 0 | 0  → Col3=0 → EXCLUDE
    DIYA SHARMA Total: | | 0 | 10000 | 0 | 0 → SKIP (subtotal)

  KAMLESH SHARMA block:
    Aditya Birla SL Large Cap Fund Reg (G) | 1041472019 | 28500 | 0 | 28500 | 28500 → Col3=28500 → INCLUDE
    Bandhan Small Cap Fund Reg (G) | 3251755/25 | 29000 | 0 | 29000 | 29000 → Col3=29000 → INCLUDE
    PGIM India Midcap Fund Reg (G) | 9106398181 | 32500 | 0 | 32500 | 32500 → Col3=32500 → INCLUDE
    KAMLESH SHARMA Total: | | 90000 | 0 | 90000 | 90000 → SKIP (subtotal)

  Note: KAMLESH funds have Col2=0 but Col3=non-zero. These MUST be included.

  If no SIP Summary section in PDF → sipSummary = [].
  Format: [{ "name": "fund name exactly as printed", "amount": 29000 }, ...]

SUB-CATEGORY DATA (subCategories field — top level, NOT inside members):
  Source: "Mutual Fund Allocation by Sub Category" table ONLY. Do NOT compute from holdings.
  Extract every row from that table exactly as printed.
  Format: [{ "cat": "Equity: Mid Cap", "invested": 0, "current": 0, "cagr": 0, "allocation": 0 }, ...]
  allocation = the Allocation % column value from that table (plain float, e.g. 19.61)
  If this table does not exist in the PDF, set subCategories to empty array [].

AMC ALLOCATION DATA (amcAllocation field — top level, NOT inside members):
  Source: "Mutual Fund Allocation by Fund" table in the PDF.
  Extract each AMC row: AMC name, Purchase Value, Current Value, Allocation %.
  Format: [{ "amc": "Tata Mutual Fund", "invested": 0, "current": 0, "allocation": 0 }]
  allocation = Allocation % column value (plain float).
  If table not found, set amcAllocation to empty array [].

Return this exact JSON structure:
{
  "title": "Family/Client Name Portfolio",
  "meta": "N applicants · N schemes · statement date · RM name if available",
  "sipSummary": [{ "name": "fund name", "amount": 0 }],
  "subCategories": [{ "cat": "Equity: Mid Cap", "invested": 0, "current": 0, "cagr": 0, "allocation": 0 }],
  "amcAllocation": [{ "amc": "Tata Mutual Fund", "invested": 0, "current": 0, "allocation": 0 }],
  "investmentSince": "DD MMM YYYY (earliest purchase date found across all holdings in the entire PDF)",
  "members": [
    {
      "name": "All Members",
      "initials": "ALL",
      "summary": { "invested": 0, "current": 0, "gain": 0, "gainPct": 0, "sipTotal": 0, "xirr": 0 },
      "assetMix": { "Equity": 0, "Debt": 0, "Hybrid": 0, "Liquid": 0 },
      "categories": { "Category Name": 0 },
      "holdings": [
        { "name": "Full scheme name", "cat": "category", "badge": "eq", "invested": 0, "current": 0, "xirr": 0, "holder": "applicant name" }
      ],
      "sips": [{ "name": "fund short name", "amount": 0, "date": "20th" }],
      "goals": [],
      "risk": { "score": 6.5, "label": "Moderately Aggressive" },
      "alerts": [{ "type": "warn", "text": "specific insight based on actual data" }]
    }
  ]
}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM }]
        },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: b64 } },
            { text: `Filename: "${filename}". Extract all data from this portfolio statement and return the JSON.` }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
       throw new Error(data.error?.message || 'Failed to call Gemini API');
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    res.status(200).json(JSON.parse(clean));

  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: 'Failed to process PDF with Gemini: ' + error.message });
  }
};
