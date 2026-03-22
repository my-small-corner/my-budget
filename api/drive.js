import { google } = require('googleapis');
import formidable from 'formidable';
import fs from 'fs';

export const config = { api: { bodyParser: false } };

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const expenseId = Array.isArray(fields.expenseId) ? fields.expenseId[0] : fields.expenseId;

    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await getOrCreateFolder(drive);

    const uploadRes = await drive.files.create({
      requestBody: { name: `${expenseId}_${file.originalFilename}`, parents: [folderId] },
      media: { mimeType: file.mimetype, body: fs.createReadStream(file.filepath) },
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
}
