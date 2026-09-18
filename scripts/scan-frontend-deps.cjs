/**
 * Frontend Dependency Scanner
 * 
 * Scans the AgriShop codebase to build a dependency graph:
 *   DB table → RPC → store → component → screen → route → test
 * 
 * Output: dependency_graph.json (uploaded to DB via deploy script)
 * 
 * This scanner does NOT read file contents beyond what's needed for
 * dependency detection. It extracts structural metadata only.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../src');
const TESTS_DIR = path.resolve(__dirname, '../tests');

// ─── Tables/RPCs to track ────────────────────────────────────────────
const DB_TABLES = [
  'customers', 'sales', 'sale_items', 'customer_payments', 'products',
  'product_variants', 'companies', 'employees', 'users', 'returns',
  'return_items', 'voids', 'purchases', 'purchase_items', 'inventory_movements',
  'credit_limit_requests', 'notifications', 'reminder_configs', 'reminder_logs',
  'reminder_occurrences', 'stock_adjustments', 'supplier_payments', 'shops',
  'shop_requests', 'cash_reconciliations', 'daily_cash_reconciliations',
  'activity_log', 'audit_events', 'business_settings', 'app_settings',
  'customer_crops',
];

const RPC_NAMES = [
  'archive_customer', 'restore_customer', 'create_customer', 'update_customer_image',
  'update_customer_due_date', 'create_sale', 'void_sale', 'void_sale_v1',
  'process_return', 'process_reminders', 'record_customer_payment',
  'approve_credit_limit_request', 'reject_credit_limit_request',
  'delete_credit_limit_request', 'create_credit_limit_request',
  'deactivate_employee_v1', 'delete_product', 'adjust_stock',
  'get_authenticated_user_id', 'app_current_user_id', 'app_is_admin',
  'current_shop_id', 'record_incident', 'search_incidents',
  'search_incident_by_fingerprint', 'start_agent_task', 'record_attempt',
  'detect_loop', 'escalate_task', 'resolve_task', 'abandon_task',
  'search_agent_tasks', 'record_resolution', 'search_resolutions',
  'record_memory', 'search_memory', 'analyze_table_impact',
  'analyze_function_impact', 'classify_change_risk', 'analyze_column_impact',
  'run_sql',
];

// ─── Scan functions ──────────────────────────────────────────────────

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');

  const refs = {
    tables: [],
    rpcs: [],
    stores: [],
    components: [],
    hooks: [],
    routes: [],
  };

  // Detect DB table references via .from('table') or .rpc('function')
  for (const table of DB_TABLES) {
    // .from('table') pattern
    const fromRegex = new RegExp(`\\.from\\s*\\(\\s*['"\`]${table}['"\`]`, 'g');
    if (fromRegex.test(content)) refs.tables.push({ table, evidence: 'from_call' });

    // SQL string references (for run_sql based tests)
    const sqlRegex = new RegExp(`['"\`]${table}['"\`]`, 'g');
    if (sqlRegex.test(content) && !refs.tables.find(t => t.table === table)) {
      refs.tables.push({ table, evidence: 'sql_reference' });
    }
  }

  // Detect RPC calls
  for (const rpc of RPC_NAMES) {
    const rpcRegex = new RegExp(`\\.rpc\\s*\\(\\s*['"\`]${rpc}['"\`]`, 'g');
    if (rpcRegex.test(content)) refs.rpcs.push({ rpc, evidence: 'rpc_call' });
  }

  // Detect store imports/usage
  const storeFiles = fs.readdirSync(path.join(SRC_DIR, 'stores')).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  for (const storeFile of storeFiles) {
    const storeName = storeFile.replace(/\.(ts|tsx)$/, '');
    const importRegex = new RegExp(`from\\s+['"]@/stores/${storeName}['"]`, 'g');
    if (importRegex.test(content)) refs.stores.push({ store: storeName, evidence: 'direct_import' });
  }

  // Detect hook imports (custom hooks in src/hooks/)
  if (fs.existsSync(path.join(SRC_DIR, 'hooks'))) {
    const hookFiles = fs.readdirSync(path.join(SRC_DIR, 'hooks')).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
    for (const hookFile of hookFiles) {
      const hookName = hookFile.replace(/\.(ts|tsx)$/, '');
      const importRegex = new RegExp(`from\\s+['"]@/hooks/${hookName}['"]`, 'g');
      if (importRegex.test(content)) refs.hooks.push({ hook: hookName, evidence: 'direct_import' });
    }
  }

  // Detect route references (path strings)
  const routeRegex = /path\s*:\s*['"`](\/[^'"`]+)['"`]/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    refs.routes.push({ route: match[1], evidence: 'route_definition' });
  }

  return { file: relPath, refs };
}

// ─── Component file resolver ──────────────────────────────────────
// Maps a component name to its source file path
const componentCache = {};
function findComponentFile(componentName) {
  if (componentCache[componentName]) return componentCache[componentName];

  // Build an index of all component/page files
  function indexDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        indexDir(fullPath);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const baseName = entry.name.replace(/\.(tsx?|jsx?)$/, '');
        const relPath = path.relative(path.resolve(__dirname, '..'), fullPath).replace(/\\/g, '/');
        componentCache[baseName] = relPath;
      }
    }
  }
  // Index once
  if (Object.keys(componentCache).length === 0) {
    indexDir(SRC_DIR);
  }
  return componentCache[componentName] || null;
}

function buildDependencyGraph() {
  const graph = {
    tables: {},    // table → [{file, evidence, layer}]
    rpcs: {},      // rpc → [{file, evidence, layer}]
    stores: {},    // store → [{file, evidence, layer}]
    routes: {},    // route → [{file, evidence, layer}]
    routePages: {}, // route → page file (from router parsing)
    scannedAt: new Date().toISOString(),
    fileCount: 0,
  };

  // Parse router/index.tsx to build route → page mapping
  const routerPath = path.join(SRC_DIR, 'router/index.tsx');
  if (fs.existsSync(routerPath)) {
    const routerContent = fs.readFileSync(routerPath, 'utf8');
    // Match: { path: "xxx", element: <ComponentName /> }
    const routeRegex = /path:\s*["'`\/]+([^"'`]+)["'`]\s*,\s*element:\s*<([A-Za-z]+)[^/]*\/>/g;
    let match;
    const parentPaths = [];
    // Simple stack-based parent path tracking
    let currentParent = '';
    const lines = routerContent.split('\n');
    for (const line of lines) {
      // Track parent path patterns like path: "/admin"
      const parentMatch = line.match(/path:\s*["'`](\/[^"'`]+)["'`]/);
      if (parentMatch && !line.includes('element:')) {
        currentParent = parentMatch[1];
      }
      // Track relative path + component
      const routeMatch = line.match(/path:\s*["'`]([^"'`]+)["'`]\s*,\s*element:\s*<([A-Za-z]+)/);
      if (routeMatch) {
        const routePath = routeMatch[1];
        const componentName = routeMatch[2];
        // Resolve the component file
        const componentFile = findComponentFile(componentName);
        if (componentFile) {
          // Build full route path
          let fullPath;
          if (routePath.startsWith('/')) {
            fullPath = routePath;
          } else if (currentParent) {
            fullPath = currentParent + '/' + routePath;
          } else {
            fullPath = '/' + routePath;
          }
          // Normalize double slashes
          fullPath = fullPath.replace(/\/+/g, '/');
          graph.routePages[fullPath] = componentFile;
        }
      }
    }
  }

  // Scan all frontend source files
  function scanDir(dir, layer) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, layer);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        graph.fileCount++;
        const result = scanFile(fullPath);

        // Map table references
        for (const ref of result.refs.tables) {
          if (!graph.tables[ref.table]) graph.tables[ref.table] = [];
          graph.tables[ref.table].push({ file: result.file, evidence: ref.evidence, layer });
        }

        // Map RPC references
        for (const ref of result.refs.rpcs) {
          if (!graph.rpcs[ref.rpc]) graph.rpcs[ref.rpc] = [];
          graph.rpcs[ref.rpc].push({ file: result.file, evidence: ref.evidence, layer });
        }

        // Map store references
        for (const ref of result.refs.stores) {
          if (!graph.stores[ref.store]) graph.stores[ref.store] = [];
          graph.stores[ref.store].push({ file: result.file, evidence: ref.evidence, layer });
        }

        // Map route references
        for (const ref of result.refs.routes) {
          if (!graph.routes[ref.route]) graph.routes[ref.route] = [];
          graph.routes[ref.route].push({ file: result.file, evidence: ref.evidence, layer });
        }
      }
    }
  }

  // Scan in order: lib → stores → hooks → components → pages → tests
  if (fs.existsSync(path.join(SRC_DIR, 'lib'))) scanDir(path.join(SRC_DIR, 'lib'), 'lib');
  scanDir(path.join(SRC_DIR, 'stores'), 'store');
  if (fs.existsSync(path.join(SRC_DIR, 'hooks'))) scanDir(path.join(SRC_DIR, 'hooks'), 'hook');
  scanDir(path.join(SRC_DIR, 'components'), 'component');
  scanDir(path.join(SRC_DIR, 'pages'), 'page');
  if (fs.existsSync(path.join(TESTS_DIR, 'e2e'))) scanDir(path.join(TESTS_DIR, 'e2e'), 'test');
  scanDir(path.join(TESTS_DIR, 'integration'), 'test');
  scanDir(path.join(TESTS_DIR, 'unit'), 'test');

  return graph;
}

// ─── Main ────────────────────────────────────────────────────────────

const graph = buildDependencyGraph();

// Output as JSON
const outputPath = path.resolve(__dirname, '../dependency_graph.json');
fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));

// Print summary
console.log(`Scanned ${graph.fileCount} files`);
console.log(`Tables tracked: ${Object.keys(graph.tables).length}`);
console.log(`RPCs tracked: ${Object.keys(graph.rpcs).length}`);
console.log(`Stores tracked: ${Object.keys(graph.stores).length}`);
console.log(`Routes tracked: ${Object.keys(graph.routes).length}`);

// Print a sample
console.log('\n--- Sample: customers table ---');
const customerRefs = graph.tables['customers'] || [];
for (const ref of customerRefs.slice(0, 10)) {
  console.log(`  ${ref.layer}: ${ref.file} (${ref.evidence})`);
}
if (customerRefs.length > 10) console.log(`  ... and ${customerRefs.length - 10} more`);

console.log('\n--- Sample: record_customer_payment RPC ---');
const paymentRefs = graph.rpcs['record_customer_payment'] || [];
for (const ref of paymentRefs) {
  console.log(`  ${ref.layer}: ${ref.file} (${ref.evidence})`);
}

console.log('\n--- Sample: customersStore ---');
const storeRefs = graph.stores['customersStore'] || [];
for (const ref of storeRefs.slice(0, 10)) {
  console.log(`  ${ref.layer}: ${ref.file} (${ref.evidence})`);
}
if (storeRefs.length > 10) console.log(`  ... and ${storeRefs.length - 10} more`);

console.log(`\nGraph written to ${outputPath}`);
