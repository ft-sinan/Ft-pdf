import express from 'express';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { createApi } from './api.mjs';
const { app, db } = createApi();
const http = createServer(app);
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
app.use('/pdf-assets/fonts', express.static(resolve('node_modules/pdfjs-dist/standard_fonts')));
app.use('/pdf-assets/cmaps', express.static(resolve('node_modules/pdfjs-dist/cmaps')));
if (production) {
  app.use(express.static(resolve('dist'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    server: { middlewareMode: true, allowedHosts: true, hmr: { server: http } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const i = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (i >= 0 ? process.argv[i + 1] : 5173));
http.listen(port, '0.0.0.0', () =>
  console.log(`Ft PDF ${production ? '' : 'development '}workspace listening on 0.0.0.0:${port}`),
);
process.on('SIGTERM', () => {
  http.close(() => {
    db.close();
    process.exit(0);
  });
});
