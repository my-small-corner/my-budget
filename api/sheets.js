const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Expenses';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function ensureHeaders(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:H1`,
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['ID', 'Month', 'Name', 'Amount', 'DatePaid', 'Category', 'Type', 'DriveURL']],
      },
    });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    await ensureHeaders(sheets);

    const { action, month, expense, id } = req.method === 'GET'
      ? req.query
      : { ...req.query, ...req.body };

    // GET expenses for a month
    if (req.method === 'GET' && action === 'get') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:H10000`,
      });
      const rows = response.data.values || [];
      const expenses = rows
        .filter(r => r[1] === month)
        .map(r => ({
          id: r[0], month: r[1], name: r[2],
          amount: parseFloat(r[3]) || 0,
          datePaid: r[4] || '', cat: r[5] || '',
          type: r[6] || 'reg', driveUrl: r[7] || '',
        }));
      return res.status(200).json({ expenses });
    }

    // GET all months
    if (req.method === 'GET' && action === 'months') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!B2:B10000`,
      });
      const rows = response.data.values || [];
      const months = [...new Set(rows.flat().filter(Boolean))];
      return res.status(200).json({ months });
    }

    // POST - add expense
    if (req.method === 'POST' && action === 'add') {
      const e = expense;
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:H`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[e.id, e.month, e.name, e.amount, e.datePaid, e.cat, e.type, e.driveUrl || '']],
        },
      });
      return res.status(200).json({ success: true });
    }

    // POST - delete expense
    if (req.method === 'POST' && action === 'delete') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:A10000`,
      });
      const rows = response.data.values || [];
      const rowIndex = rows.findIndex(r => r[0] === id);
      if (rowIndex !== -1) {
        const sheetRes = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const sheet = sheetRes.data.sheets.find(s => s.properties.title === SHEET_NAME);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId: sheet.properties.sheetId,
                  dimension: 'ROWS',
                  startIndex: rowIndex + 1,
                  endIndex: rowIndex + 2,
                },
              },
            }],
          },
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
