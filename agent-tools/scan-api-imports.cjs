const fs = require('fs');
const path = require('path');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const srcDir = path.join(process.cwd(), 'src');
const files = walk(srcDir);

const importRe = /import\s+\{([^}]+)\}\s+from\s+['"]@\/db\/api['"];?/g;
const imported = new Map(); // name -> Set(file)

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = importRe.exec(text))) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) {
      // handle alias: foo as bar
      const [orig] = n.split(/\s+as\s+/);
      const name = orig.trim();
      if (!imported.has(name)) imported.set(name, new Set());
      imported.get(name).add(path.relative(process.cwd(), f));
    }
  }
}

const apiPath = path.join(srcDir, 'db', 'api.ts');
const apiText = fs.readFileSync(apiPath, 'utf8');
const exportRe = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g;
const exported = new Set();
let em;
while ((em = exportRe.exec(apiText))) {
  exported.add(em[1]);
}

const missing = [...imported.keys()].filter((n) => !exported.has(n)).sort();

console.log(
  JSON.stringify(
    {
      importedCount: imported.size,
      exportedCount: exported.size,
      missingCount: missing.length,
      missing: missing.map((name) => ({
        name,
        files: [...imported.get(name)].sort(),
      })),
    },
    null,
    2
  )
);






