var fs = require('fs');
var path = require('path');
var md = path.join('supabase/migrations');
var files = fs.readdirSync(md).filter(function(f){return f.endsWith('.sql')}).sort();

var sql = '';
sql += '-- QA DATABASE FULL DEPLOYMENT\n\n';

// Types
var types = [
  "DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin','co_admin','employee'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  "DO $$ BEGIN CREATE TYPE payment_type AS ENUM ('full','partial','credit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  "DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('cash','bank_transfer','mobile'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  "DO $$ BEGIN CREATE TYPE sale_status AS ENUM ('completed','voided','returned'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  "DO $$ BEGIN CREATE TYPE movement_type AS ENUM ('sale','return','adjustment','purchase','void'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  "DO $$ BEGIN CREATE TYPE product_category AS ENUM ('seed','fertilizer','pesticide','herbicide','equipment','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
];
sql += types.join('\n') + '\n\n';

// Base tables
var baseTables = fs.readFileSync('_qa_bootstrap.sql', 'utf8');
sql += baseTables + '\n';

// Migrations
for (var i = 0; i < files.length; i++) {
  sql += '-- ' + files[i] + '\n';
  sql += fs.readFileSync(path.join(md, files[i]), 'utf8');
  sql += '\n\n';
}

// Write combined
fs.writeFileSync('_qa_full_deploy.sql', sql);

// Split into 3 parts
var lines = sql.split('\n');
var third = Math.ceil(lines.length / 3);
fs.writeFileSync('_qa_deploy_part1.sql', lines.slice(0, third).join('\n'));
fs.writeFileSync('_qa_deploy_part2.sql', lines.slice(third, third*2).join('\n'));
fs.writeFileSync('_qa_deploy_part3.sql', lines.slice(third*2).join('\n'));

console.log('Combined: ' + Math.round(sql.length/1024) + 'KB, ' + lines.length + ' lines');
console.log('Part1: ' + Math.round(fs.statSync('_qa_deploy_part1.sql').size/1024) + 'KB');
console.log('Part2: ' + Math.round(fs.statSync('_qa_deploy_part2.sql').size/1024) + 'KB');
console.log('Part3: ' + Math.round(fs.statSync('_qa_deploy_part3.sql').size/1024) + 'KB');
