const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const candidateDirs = [
  path.join(rootDir, '.output', 'public'),
  path.join(rootDir, '.vercel', 'output', 'static'),
];
const outputPublicDir = candidateDirs.find(d => fs.existsSync(d));
const distDir = path.join(rootDir, 'dist');

console.log('📦 Generating dist/ folder for web hosting...');

if (!outputPublicDir) {
  console.error('❌ Build output directory not found (.output/public or .vercel/output/static). Please run vite build first.');
  process.exit(1);
}
console.log(`📂 Using build output from: ${outputPublicDir}`);

// 1. Recreate dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. Copy all files and folders from .output/public into dist/
function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(outputPublicDir, distDir);

// 3. Find asset files
const assetsDir = path.join(distDir, 'assets');
let cssFile = '';
let mainJsFile = '';
const preloadScripts = [];

if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  for (const f of files) {
    if (f.startsWith('styles-') && f.endsWith('.css')) {
      cssFile = f;
    } else if (f.startsWith('index-') && f.endsWith('.js')) {
      mainJsFile = f;
    } else if ((f.startsWith('routes-') || f.startsWith('rolldown-')) && f.endsWith('.js')) {
      preloadScripts.push(f);
    }
  }
}

if (!mainJsFile) {
  // Fallback to first .js file that is not chunk-only
  const files = fs.readdirSync(assetsDir);
  const jsFiles = files.filter(f => f.endsWith('.js'));
  mainJsFile = jsFiles.find(f => f.startsWith('index-')) || jsFiles[0] || '';
}

const preloadTags = preloadScripts
  .map(f => `    <link rel="modulepreload" href="/assets/${f}" />`)
  .join('\n');

// 4. Generate clean HTML template
const indexHtmlContent = `<!DOCTYPE html>
<html lang="uz">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TimeWork — Davomat va Shaxsiy Kabinet</title>
    <meta name="description" content="FaceID 2.0 AI va GPS orqali ishga keldim / ketdim avtomatik qayd qilish stansiyasi." />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="alternate icon" href="/favicon.ico" />
    ${cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}" />` : ''}
${preloadTags}
  </head>
  <body class="min-h-screen bg-slate-950 text-white font-sans antialiased">
    <script>
      window.$_TSR = {
        buffer: [],
        initialized: false,
        router: {
          matches: [],
          manifest: undefined,
          dehydratedData: {},
          lastMatchId: undefined
        },
        h: function() { this.hydrated = true; },
        e: function() { this.streamEnded = true; },
        c: function() {},
        p: function(fn) { if (typeof fn === 'function') fn(); }
      };
      self.$_TSR = window.$_TSR;
    </script>
    <div id="root"></div>
    ${mainJsFile ? `<script type="module" src="/assets/${mainJsFile}"></script>` : ''}
  </body>
</html>
`;

// Write index.html, 200.html, 404.html
fs.writeFileSync(path.join(distDir, 'index.html'), indexHtmlContent, 'utf-8');
fs.writeFileSync(path.join(distDir, '200.html'), indexHtmlContent, 'utf-8');
fs.writeFileSync(path.join(distDir, '404.html'), indexHtmlContent, 'utf-8');

// Generate route subdirectories with index.html for direct static routing
const routesToPrerender = ['camera-gps-test'];
for (const r of routesToPrerender) {
  const rDir = path.join(distDir, r);
  fs.mkdirSync(rDir, { recursive: true });
  fs.writeFileSync(path.join(rDir, 'index.html'), indexHtmlContent, 'utf-8');
}

// If building for Vercel, also sync to .vercel/output/static
const vercelStatic = path.join(rootDir, '.vercel', 'output', 'static');
if (fs.existsSync(vercelStatic)) {
  fs.writeFileSync(path.join(vercelStatic, 'index.html'), indexHtmlContent, 'utf-8');
  fs.writeFileSync(path.join(vercelStatic, '200.html'), indexHtmlContent, 'utf-8');
  fs.writeFileSync(path.join(vercelStatic, '404.html'), indexHtmlContent, 'utf-8');
  for (const r of routesToPrerender) {
    const rDir = path.join(vercelStatic, r);
    fs.mkdirSync(rDir, { recursive: true });
    fs.writeFileSync(path.join(rDir, 'index.html'), indexHtmlContent, 'utf-8');
  }
}

// 5. Add SPA redirect rules for Apache and Netlify/Cloudflare
fs.writeFileSync(path.join(distDir, '_redirects'), '/* /index.html 200\n', 'utf-8');

const htaccessContent = `<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
`;
fs.writeFileSync(path.join(distDir, '.htaccess'), htaccessContent, 'utf-8');

const vercelJsonContent = JSON.stringify({
  rewrites: [{ source: '/(.*)', destination: '/index.html' }]
}, null, 2);
fs.writeFileSync(path.join(distDir, 'vercel.json'), vercelJsonContent, 'utf-8');

console.log('✅ dist/ successfully created with:');
console.log('   - dist/index.html');
console.log('   - dist/assets/ (' + (fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).length : 0) + ' bundle files)');
console.log('   - dist/models/ (Face-API AI offline models)');
console.log('   - dist/200.html, dist/404.html, dist/.htaccess, dist/_redirects (SPA routing ready for any hosting)');
