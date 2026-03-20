const { google } = require('googleapis');
const { Readable } = require('stream');

const DRIVE_FOLDER_NAME = 'Yitsy Budget Bills';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

async function getOrCreateFolder(drive) {
  // Check if folder exists
  const res = await drive.files.list({
    q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  return folder.data.id;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Parse multipart form data
    const contentType = event.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No boundary found' }) };
    }

    const body = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    const parts = parseMultipart(body, boundary);

    const filePart = parts.find(p => p.name === 'file');
    const expenseIdPart = parts.find(p => p.name === 'expenseId');

    if (!filePart) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file provided' }) };
    }

    const folderId = await getOrCreateFolder(drive);
    const fileName = `${expenseIdPart?.value || Date.now()}_${filePart.filename}`;

    const fileStream = Readable.from(filePart.data);
    const uploadRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: filePart.contentType || 'application/octet-stream',
        body: fileStream,
      },
      fields: 'id, webViewLink',
    });

    // Make the file publicly readable
    await drive.permissions.create({
      fileId: uploadRes.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: uploadRes.data.webViewLink, id: uploadRes.data.id }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
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
        data: data,
        value: filenameMatch ? null : data.toString(),
      });
    }
    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }
  return parts;
}
