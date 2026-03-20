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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    await ensureHeaders(sheets);

    const params = new URLSearchParams(event.queryStringParameters || {});
    const action = params.get('action') || (event.body ? JSON.parse(event.body).action : null);

    // GET expenses for a month
    if (event.httpMethod === 'GET' && action === 'get') {
      const month = params.get('month');
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:H10000`,
      });
      const rows = res.data.values || [];
      const expenses = rows
        .filter(r => r[1] === month)
        .map(r => ({
          id: r[0],
          month: r[1],
          name: r[2],
          amount: parseFloat(r[3]) || 0,
          datePaid: r[4] || '',
          cat: r[5] || '',
          type: r[6] || 'reg',
          driveUrl: r[7] || '',
        }));
      return { statusCode: 200, headers, body: JSON.stringify({ expenses }) };
    }

    // GET all months that have data
    if (event.httpMethod === 'GET' && action === 'months') {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!B2:B10000`,
      });
      const rows = res.data.values || [];
      const months = [...new Set(rows.flat().filter(Boolean))];
      return { statusCode: 200, headers, body: JSON.stringify({ months }) };
    }

    // POST — add or delete
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // Add expense
      if (body.action === 'add') {
        const e = body.expense;
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A:H`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[e.id, e.month, e.name, e.amount, e.datePaid, e.cat, e.type, e.driveUrl || '']],
          },
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Delete expense by ID
      if (body.action === 'delete') {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A2:A10000`,
        });
        const rows = res.data.values || [];
        const rowIndex = rows.findIndex(r => r[0] === body.id);
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
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
