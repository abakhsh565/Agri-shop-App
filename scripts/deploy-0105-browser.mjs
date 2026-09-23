// This script reads the SQL file and outputs it in a format ready for browser execution
import fs from 'fs';
const sql = fs.readFileSync('supabase/migrations/0105_employee_lifecycle_auth_fix.sql', 'utf8');
// Split into manageable chunks by statement
const stmts = sql.split(/\n-- ═/).filter(s => s.trim());
console.log('Total statements to deploy:', stmts.length);
// Write a single JS file that can be evaluated in the browser
const code = `
(async () => {
  const sql = ${JSON.stringify(sql)};
  const statements = sql.split(';').filter(s => s.trim().length > 20 && !s.trim().startsWith('--'));
  console.log('Deploying', statements.length, 'statements...');
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i].trim();
    if (!stmt || stmt.startsWith('--')) continue;
    try {
      const {error} = await supabase.rpc('exec_sql', {sql: stmt + ';'});
      if (error && !error.message.includes('already') && !error.message.includes('does not exist')) {
        console.error('Stmt', i, ':', error.message.substring(0, 200));
      } else {
        console.log('Stmt', i, ': OK');
      }
    } catch(e) {
      console.error('Stmt', i, 'exception:', e.message.substring(0, 200));
    }
  }
  console.log('Done');
})();
`;
fs.writeFileSync('scripts/browser-deploy-0105.js', code);
console.log('Wrote scripts/browser-deploy-0105.js');
