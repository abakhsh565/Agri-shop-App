const fs = require('fs');
const https = require('https');

const sql = fs.readFileSync('supabase/migrations/0040_reminder_log_occurrence_id.sql', 'utf8');
const AUTH = 'sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG';
const HOST = 'gkswcfljxlutkfdvvqng.supabase.co';

function runSql(sqlStmt) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://' + HOST + '/rest/v1/sql', {
      method: 'POST',
      headers: { 'apikey': AUTH, 'Authorization': 'Bearer ' + AUTH, 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ query: sqlStmt }));
    req.end();
  });
}

function parseSqlStatements(sqlText) {
  const stmts = [];
  let current = '';
  let inSingleLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    const next = sqlText[i + 1] || '';
    
    if (inBlockComment) {
      if (ch === '-' && next === '-') { inBlockComment = false; i++; }
      continue;
    }
    
    if (inSingleLineComment) {
      if (ch === '\n') { inSingleLineComment = false; current += ch; }
      continue;
    }
    
    if (inString) {
      current += ch;
      if (ch === stringChar && sqlText[i - 1] !== '\\') inString = false;
      continue;
    }
    
    if (ch === '-' && next === '-') {
      inSingleLineComment = true;
      continue;
    }
    
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    
    if (ch === '\'' || ch === '"') {
      inString = true;
      stringChar = ch;
    }
    
    current += ch;
    
    if (ch === ';' && !inString && !inSingleLineComment && !inBlockComment) {
      const stmt = current.trim();
      if (stmt) stmts.push(stmt);
      current = '';
    }
  }
  
  const stmt = current.trim();
  if (stmt) stmts.push(stmt);
  return stmts;
}

async function main() {
  const statements = parseSqlStatements(sql);
  console.log('Parsed', statements.length, 'statements');
  
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    console.log('\n--- Statement ' + (i + 1) + ' ---');
    console.log(s.slice(0, 100).replace(/\n/g, ' ') + (s.length > 100 ? '...' : ''));
    try {
      const r = await runSql(s);
      const body = JSON.parse(r.body);
      if (body.error) {
        console.log('ERROR:', body.error.message);
      } else {
        console.log('OK. Status:', r.status);
      }
    } catch (e) {
      console.log('EXCEPTION:', e.message);
    }
  }
}

main();
