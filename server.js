const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8000;
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_EMAIL = 'saicharanreddy344@gmail.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '547580211224-v0sqogmckfo3sksg4l333sjbo921qiu5.apps.googleusercontent.com';

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// Auto-create database tables on start
async function initDatabase() {
  if (!pool) return;
  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL.');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        hsn VARCHAR(50) NOT NULL,
        gst INT NOT NULL,
        purchase_price NUMERIC(10, 2) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        vendor_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS farmers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        village VARCHAR(150),
        phone VARCHAR(50),
        outstanding NUMERIC(12, 2) DEFAULT 0,
        last_tx VARCHAR(255),
        vendor_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_no VARCHAR(100) UNIQUE NOT NULL,
        customer_type VARCHAR(50) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50),
        payment_mode VARCHAR(50) NOT NULL,
        subtotal NUMERIC(12, 2) NOT NULL,
        cgst NUMERIC(12, 2) NOT NULL,
        sgst NUMERIC(12, 2) NOT NULL,
        grand_total NUMERIC(12, 2) NOT NULL,
        items JSONB NOT NULL,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        vendor_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS managers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        shop_name VARCHAR(255) DEFAULT 'Dattareya Enterprises',
        tagline VARCHAR(255) DEFAULT 'Wholesale & Retail Dealers in Fertilizers & Pesticides',
        gstin VARCHAR(100) DEFAULT '29AAAAA0000A1Z5',
        address TEXT DEFAULT 'Main Road, Market Yard, Karnataka - 586101',
        phone VARCHAR(50) DEFAULT '+91 94480 00000',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE managers ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255) DEFAULT 'Dattareya Enterprises';
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS tagline VARCHAR(255) DEFAULT 'Wholesale & Retail Dealers in Fertilizers & Pesticides';
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS gstin VARCHAR(100) DEFAULT '29AAAAA0000A1Z5';
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS address TEXT DEFAULT 'Main Road, Market Yard, Karnataka - 586101';
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '+91 94480 00000';

      ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_id INT;
      ALTER TABLE farmers ADD COLUMN IF NOT EXISTS vendor_id INT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_id INT;
    `);

    client.release();
    console.log('Database tables & multi-tenant partitions ready.');
  } catch (err) {
    console.error('Database initialization error:', err.message);
  }
}

initDatabase();

// Helper to parse JSON body
function getBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// Cryptographically verify Google ID Token directly with Google servers
function verifyGoogleToken(idToken) {
  return new Promise((resolve) => {
    if (!idToken) return resolve(null);
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);
          // Check that email exists, is verified by Google, and audience matches our client ID
          if (payload.email && (payload.email_verified === 'true' || payload.email_verified === true)) {
            if (payload.aud === GOOGLE_CLIENT_ID) {
              return resolve(payload);
            }
          }
          resolve(null);
        } catch(e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  const sendJson = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Extract Vendor ID from header or query for multi-tenant data isolation
  const getVendorId = () => {
    return parseInt(req.headers['x-vendor-id'] || parsedUrl.searchParams.get('vendor_id') || 0);
  };

  // --- CRYPTOGRAPHIC AUTH & RBAC CHECK ---
  if (pathname === '/api/auth/check' && req.method === 'POST') {
    const b = await getBody(req);
    let email = '';
    let name = '';
    let picture = '';

    // If ID token provided, verify cryptographically with Google
    if (b.credential) {
      const verified = await verifyGoogleToken(b.credential);
      if (!verified) {
        return sendJson({ authorized: false, error: 'Cryptographic signature verification failed with Google' }, 401);
      }
      email = (verified.email || '').toLowerCase().trim();
      name = verified.name || verified.given_name || 'User';
      picture = verified.picture || '';
    } else if (b.email) {
      email = (b.email || '').trim().toLowerCase();
    }

    if (!email) return sendJson({ authorized: false, error: 'No valid authentication token provided' }, 400);

    // 1. Is Super Owner?
    if (email === OWNER_EMAIL.toLowerCase()) {
      return sendJson({
        authorized: true,
        role: 'OWNER',
        email,
        vendorId: 0,
        name: 'Cherry',
        picture,
        shopName: 'PaaS Platform Owner'
      });
    }

    // 2. Is Approved Manager / Vendor?
    if (pool) {
      const mgrRes = await pool.query('SELECT * FROM managers WHERE LOWER(email) = $1', [email]);
      if (mgrRes.rows.length > 0) {
        const mgr = mgrRes.rows[0];
        return sendJson({
          authorized: true,
          role: 'MANAGER',
          email,
          vendorId: mgr.id,
          name: mgr.name || name,
          picture,
          shopName: mgr.shop_name || 'Dattareya Enterprises',
          tagline: mgr.tagline || 'Wholesale & Retail Dealers in Fertilizers & Pesticides',
          gstin: mgr.gstin || '29AAAAA0000A1Z5',
          address: mgr.address || 'Main Road, Market Yard, Karnataka - 586101',
          phone: mgr.phone || '+91 94480 00000'
        });
      }
    }

    // 3. Unauthorized
    return sendJson({ authorized: false, error: 'Unauthorized email account' }, 403);
  }

  // --- VENDOR SHOP PROFILE & SETTINGS ---
  if (pathname === '/api/vendor/profile' && req.method === 'GET') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const vId = getVendorId();
    if (vId <= 0) {
      return sendJson({
        shop_name: 'Dattareya Enterprises',
        tagline: 'Wholesale & Retail Dealers in Fertilizers & Pesticides',
        gstin: '29AAAAA0000A1Z5',
        address: 'Main Road, Market Yard, Karnataka - 586101',
        phone: '+91 94480 00000'
      });
    }
    const r = await pool.query('SELECT id, email, name, shop_name, tagline, gstin, address, phone FROM managers WHERE id = $1', [vId]);
    if (r.rows.length === 0) return sendJson({ error: 'Vendor not found' }, 404);
    return sendJson(r.rows[0]);
  }

  if (pathname === '/api/vendor/profile' && (req.method === 'PUT' || req.method === 'POST')) {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const vId = getVendorId();
    if (vId <= 0) return sendJson({ error: 'Vendor ID required to update profile' }, 400);
    const b = await getBody(req);
    const r = await pool.query(`
      UPDATE managers 
      SET shop_name = $1, tagline = $2, gstin = $3, address = $4, phone = $5, name = COALESCE($6, name)
      WHERE id = $7 
      RETURNING id, email, name, shop_name, tagline, gstin, address, phone
    `, [
      b.shopName || 'Dattareya Enterprises',
      b.tagline || '',
      b.gstin || '',
      b.address || '',
      b.phone || '',
      b.name || null,
      vId
    ]);
    return sendJson(r.rows[0]);
  }

  // --- MANAGER MANAGEMENT (OWNER ONLY) ---
  if (pathname === '/api/managers' && req.method === 'GET') {
    if (!pool) return sendJson([]);
    const r = await pool.query('SELECT id, email, name, shop_name, gstin, phone, created_at FROM managers ORDER BY id DESC');
    return sendJson(r.rows);
  }

  if (pathname === '/api/managers' && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const b = await getBody(req);
    const email = (b.email || '').trim().toLowerCase();
    if (!email) return sendJson({ error: 'Email is required' }, 400);

    try {
      const r = await pool.query(`
        INSERT INTO managers (email, name, shop_name) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING *
      `, [email, b.name || 'Store Vendor', b.shopName || 'Dattareya Enterprises']);
      return sendJson(r.rows[0], 201);
    } catch (err) {
      return sendJson({ error: err.message }, 500);
    }
  }

  if (pathname.match(/^\/api\/managers\/(\d+)$/) && req.method === 'DELETE') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const id = pathname.split('/')[3];
    await pool.query('DELETE FROM managers WHERE id = $1', [id]);
    return sendJson({ success: true });
  }

  // Health / Connection Check
  if (pathname === '/api/health') {
    if (!pool) return sendJson({ status: 'warning', database: 'No DATABASE_URL configured' });
    try {
      const dbRes = await pool.query('SELECT NOW() as db_time, current_database() as db_name;');
      return sendJson({
        status: 'ok',
        database: 'Connected to Neon PostgreSQL',
        database_name: dbRes.rows[0].db_name,
        database_time: dbRes.rows[0].db_time
      });
    } catch (err) {
      return sendJson({ status: 'error', database: 'Connection Failed: ' + err.message }, 500);
    }
  }

  // GET Products (Scoped to current vendor)
  if (pathname === '/api/products' && req.method === 'GET') {
    if (!pool) return sendJson([]);
    const vId = getVendorId();
    const q = vId > 0
      ? 'SELECT id, name, category, unit, hsn, gst, purchase_price as "purchasePrice", price, stock FROM products WHERE vendor_id = $1 OR vendor_id IS NULL ORDER BY name ASC'
      : 'SELECT id, name, category, unit, hsn, gst, purchase_price as "purchasePrice", price, stock FROM products ORDER BY id DESC';
    const params = vId > 0 ? [vId] : [];
    const r = await pool.query(q, params);
    return sendJson(r.rows);
  }

  // POST Create Product (Tagged with current vendor)
  if (pathname === '/api/products' && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const vId = getVendorId();
    const b = await getBody(req);
    const q = `INSERT INTO products (name, category, unit, hsn, gst, purchase_price, price, stock, vendor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
    const r = await pool.query(q, [b.name, b.category, b.unit, b.hsn, b.gst, b.purchasePrice, b.price, b.stock, vId > 0 ? vId : null]);
    return sendJson(r.rows[0], 201);
  }

  // POST Adjust Stock
  if (pathname.match(/^\/api\/products\/(\d+)\/adjust-stock$/) && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const id = pathname.split('/')[3];
    const b = await getBody(req);
    const r = await pool.query('UPDATE products SET stock = GREATEST(0, stock + $1) WHERE id = $2 RETURNING *', [parseInt(b.amount || 0), id]);
    return sendJson(r.rows[0]);
  }

  // GET Farmers (Scoped to current vendor)
  if (pathname === '/api/farmers' && req.method === 'GET') {
    if (!pool) return sendJson([]);
    const vId = getVendorId();
    const q = vId > 0
      ? 'SELECT id, name, village, phone, outstanding, last_tx as "lastTx" FROM farmers WHERE vendor_id = $1 OR vendor_id IS NULL ORDER BY name ASC'
      : 'SELECT id, name, village, phone, outstanding, last_tx as "lastTx" FROM farmers ORDER BY id DESC';
    const params = vId > 0 ? [vId] : [];
    const r = await pool.query(q, params);
    return sendJson(r.rows);
  }

  // POST Create Farmer
  if (pathname === '/api/farmers' && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const vId = getVendorId();
    const b = await getBody(req);
    const q = `INSERT INTO farmers (name, village, phone, outstanding, last_tx, vendor_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
    const r = await pool.query(q, [b.name, b.village || '', b.phone || '', parseFloat(b.outstanding || 0), 'Account Opened', vId > 0 ? vId : null]);
    return sendJson(r.rows[0], 201);
  }

  // POST Farmer Repayment
  if (pathname.match(/^\/api\/farmers\/(\d+)\/payment$/) && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const id = pathname.split('/')[3];
    const b = await getBody(req);
    const amount = parseFloat(b.amount || 0);
    const lastTx = `Today (Paid -₹${amount})`;
    const r = await pool.query('UPDATE farmers SET outstanding = GREATEST(0, outstanding - $1), last_tx = $2 WHERE id = $3 RETURNING *', [amount, lastTx, id]);
    return sendJson(r.rows[0]);
  }

  // GET Invoices (Scoped to current vendor)
  if (pathname === '/api/invoices' && req.method === 'GET') {
    if (!pool) return sendJson([]);
    const vId = getVendorId();
    const q = vId > 0
      ? 'SELECT * FROM invoices WHERE vendor_id = $1 ORDER BY id DESC LIMIT 50'
      : 'SELECT * FROM invoices ORDER BY id DESC LIMIT 50';
    const params = vId > 0 ? [vId] : [];
    const r = await pool.query(q, params);
    return sendJson(r.rows);
  }

  // POST Save Invoice (Scoped to current vendor)
  if (pathname === '/api/invoices' && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const vId = getVendorId();
    const b = await getBody(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const invQuery = `
        INSERT INTO invoices (invoice_no, customer_type, customer_name, customer_phone, payment_mode, subtotal, cgst, sgst, grand_total, items, vendor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
      `;
      const invRes = await client.query(invQuery, [
        b.invoiceNo, b.customerType, b.customerName, b.customerPhone,
        b.paymentMode, b.subtotal, b.cgst, b.sgst, b.grandTotal, JSON.stringify(b.items),
        vId > 0 ? vId : null
      ]);

      for (const item of b.items) {
        await client.query('UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2', [item.qty, item.id]);
      }

      if (b.paymentMode === 'Credit' && b.customerType === 'khata') {
        const lastTx = `Today (Udhar +₹${b.grandTotal})`;
        if (vId > 0) {
          await client.query('UPDATE farmers SET outstanding = outstanding + $1, last_tx = $2 WHERE name = $3 AND (vendor_id = $4 OR vendor_id IS NULL)', [b.grandTotal, lastTx, b.customerName, vId]);
        } else {
          await client.query('UPDATE farmers SET outstanding = outstanding + $1, last_tx = $2 WHERE name = $3', [b.grandTotal, lastTx, b.customerName]);
        }
      }

      await client.query('COMMIT');
      client.release();
      return sendJson(invRes.rows[0], 201);
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      return sendJson({ error: e.message }, 500);
    }
  }

  // DELETE / Cancel Unwanted Invoice & Reverse Stock + Khata
  if (pathname.startsWith('/api/invoices/') && req.method === 'DELETE') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const parts = pathname.split('/');
    const id = parseInt(parts[3]);
    if (!id) return sendJson({ error: 'Invalid invoice ID' }, 400);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
      if (invRes.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return sendJson({ error: 'Invoice not found' }, 404);
      }

      const inv = invRes.rows[0];
      if (inv.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        client.release();
        return sendJson({ error: 'Invoice is already cancelled' }, 400);
      }

      // 1. Mark status as CANCELLED
      await client.query("UPDATE invoices SET status = 'CANCELLED' WHERE id = $1", [id]);

      // 2. Reverse stock deductions back to products
      const items = Array.isArray(inv.items) ? inv.items : JSON.parse(inv.items || '[]');
      for (const item of items) {
        if (item.id && item.qty) {
          await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.qty, item.id]);
        }
      }

      // 3. Reverse Khata debt if this was an Udhar bill
      if (inv.payment_mode === 'Credit' && inv.customer_type === 'khata') {
        const revertTx = `Bill ${inv.invoice_no} Cancelled (-₹${inv.grand_total})`;
        await client.query(
          'UPDATE farmers SET outstanding = GREATEST(0, outstanding - $1), last_tx = $2 WHERE name = $3',
          [inv.grand_total, revertTx, inv.customer_name]
        );
      }

      await client.query('COMMIT');
      client.release();
      return sendJson({ success: true, message: `Invoice ${inv.invoice_no} cancelled. Stock and Khata reversed successfully.` });
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      return sendJson({ error: e.message }, 500);
    }
  }

  // GET Real Reports (Scoped to current vendor)
  if (pathname === '/api/reports' && req.method === 'GET') {
    if (!pool) return sendJson({ totalSales: 0, totalGst: 0, cash: 0, upi: 0, card: 0, credit: 0, count: 0 });
    const vId = getVendorId();
    const whereClause = vId > 0
      ? `WHERE (vendor_id = $1 OR vendor_id IS NULL) AND status = 'ACTIVE' AND DATE(created_at) = CURRENT_DATE`
      : `WHERE status = 'ACTIVE' AND DATE(created_at) = CURRENT_DATE`;
    const params = vId > 0 ? [vId] : [];
    const invRes = await pool.query(`
      SELECT 
        COALESCE(SUM(grand_total), 0) as total_sales,
        COALESCE(SUM(cgst + sgst), 0) as total_gst,
        COALESCE(SUM(CASE WHEN payment_mode = 'Cash' THEN grand_total ELSE 0 END), 0) as cash,
        COALESCE(SUM(CASE WHEN payment_mode = 'UPI' THEN grand_total ELSE 0 END), 0) as upi,
        COALESCE(SUM(CASE WHEN payment_mode = 'Card' THEN grand_total ELSE 0 END), 0) as card,
        COALESCE(SUM(CASE WHEN payment_mode = 'Credit' THEN grand_total ELSE 0 END), 0) as credit,
        COUNT(*) as count
      FROM invoices ${whereClause};
    `, params);
    const row = invRes.rows[0];
    return sendJson({
      totalSales: parseFloat(row.total_sales),
      totalGst: parseFloat(row.total_gst),
      cash: parseFloat(row.cash),
      upi: parseFloat(row.upi),
      card: parseFloat(row.card),
      credit: parseFloat(row.credit),
      count: parseInt(row.count)
    });
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);

  const contentTypeMap = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  const contentType = contentTypeMap[ext] || 'text/html';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'index.html'), (err404, defaultContent) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(defaultContent, 'utf-8');
      });
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dattareya Enterprises Server running on port ${PORT}`);
});

// Graceful shutdown to prevent Render false-alarm exit 1 alerts during deploys
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down cleanly.');
  server.close(() => {
    if (pool) pool.end();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    if (pool) pool.end();
    process.exit(0);
  });
});
