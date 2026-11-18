import { PDF } from '@libpdf/core';
self.onmessage = async ({ data }) => {
  try {
    const pdf = await PDF.load(
      new Uint8Array(data.bytes),
      data.op === 'unlock' ? { credentials: data.password } : {},
    );
    if (data.op === 'unlock') {
      if (!pdf.isEncrypted) throw Error('This PDF is not encrypted.');
      if (!data.password || !pdf.isAuthenticated || !pdf.authenticate(data.password).authenticated)
        throw Error('A valid password is required.');
      pdf.removeProtection();
    } else {
      if (pdf.isEncrypted) throw Error('First unlock a copy with its password.');
      if (data.op === 'protect') {
        if (data.password.length < 8) throw Error('Use at least eight characters.');
        pdf.setProtection({
          algorithm: 'AES-256',
          userPassword: data.password,
          ownerPassword: data.password,
        });
      }
    }
    const pages = pdf.getPageCount();
    if (!pages) throw Error('No readable pages were recovered.');
    const result = new Uint8Array(await pdf.save({ incremental: false }));
    self.postMessage({ bytes: result.buffer, pages }, { transfer: [result.buffer] });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : 'PDF processing failed.' });
  }
};
