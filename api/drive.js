const { google } = require('googleapis');
const { Readable } = require('stream');

const DRIVE_FOLDER_NAME = 'Yitsy Budget Bills';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function getOrCreateFolder(drive) {
  const res = await drive.files.list({
    q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files?.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: { name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return folder.data.id;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'No boundary' });

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const parts = parseMultipart(body, boundary);
    const filePart = parts.find(p => p.name === 'file');
    const expenseIdPart = parts.find(p => p.name === 'expenseId');

    if (!filePart) return res.status(400).json({ error: 'No file' });

    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await getOrCreateFolder(drive);

    const stream = Readable.from(filePart.data);
    const fileName = `${expenseIdPart?.value || Date.now()}_${filePart.filename}`;

    const uploadRes = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: filePart.contentType || 'application/octet-stream', body: stream },
      fields: 'id, webViewLink',
    });

    await drive.permissions.create({
      fileId: uploadRes.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    return res.status(200).json({ url: uploadRes.data.webViewLink });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  let start = 0;
  while (start < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;
    const headerStart = boundaryIndex + boundaryBuffer.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2;
    const data = buffer.slice(dataStart, dataEnd);
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const contentTypeMatch = headerStr.match(/Content-Type: ([^\r\n]+)/);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch ? filenameMatch[1] : null,
        contentType: contentTypeMatch ? contentTypeMatch[1] : null,
        data,
        value: filenameMatch ? null : data.toString(),
      });
    }
    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }
  return parts;
}
