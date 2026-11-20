const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8000;
const DATABASE_URL = process.env.DATABASE_URL;

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
    console.log('Connected to PostgreSQL successfully.');
    
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS farmers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        village VARCHAR(150),
        phone VARCHAR(50),
        outstanding NUMERIC(12, 2) DEFAULT 0,
        last_tx VARCHAR(255),
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default fertilizer/pesticide products if empty
    const productCount = await client.query('SELECT count(*) FROM products');
    if (parseInt(productCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO products (name, category, unit, hsn, gst, purchase_price, price, stock) VALUES
        ('Urea 45kg (Neem Coated)', 'Fertilizer', 'Bag', '3102', 5, 242.00, 266.00, 450),
        ('DAP 50kg (Di-Ammonium)', 'Fertilizer', 'Bag', '3105', 5, 1250.00, 1350.00, 180),
        ('MOP 50kg (Potash)', 'Fertilizer', 'Bag', '3104', 5, 1600.00, 1700.00, 85),
        ('Coragen 60ml (FMC)', 'Pesticide', 'Bottle', '3808', 18, 820.00, 920.00, 42),
        ('Confidor 100ml (Bayer)', 'Pesticide', 'Bottle', '3808', 18, 410.00, 470.00, 6),
        ('Roundup 1L (Herbicide)', 'Pesticide', 'Bottle', '3808', 18, 480.00, 540.00, 55),
        ('Zinc Sulphate 21% 10kg', 'Fertilizer', 'Bag', '2833', 12, 380.00, 440.00, 4);
      `);
      console.log('Seeded default products.');
    }

    // Seed default farmers if empty
    const farmerCount = await client.query('SELECT count(*) FROM farmers');
    if (parseInt(farmerCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO farmers (name, village, phone, outstanding, last_tx) VALUES
        ('Ramesh Gowda', 'Hosur', '9448123456', 24500.00, '18-Nov-2026 (Udhar +₹4,800)'),
        ('Suresh Patil', 'Mallapur', '9880987654', 12800.00, '15-Nov-2026 (Paid -₹10,000)'),
        ('Basavaraj K', 'Bableshwar', '9741238910', 48000.00, '12-Nov-2026 (Udhar +₹18,500)'),
        ('Mallikarjun Hiremath', 'Teggi', '9448554433', 6400.00, '20-Nov-2026 (Paid -₹5,000)'),
        ('Ningappa Doddamani', 'Kukanur', '9845112233', 31200.00, '04-Nov-2026 (Udhar +₹8,200)');
      `);
      console.log('Seeded default farmers.');
    }

    client.release();
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // JSON Response helper
  const sendJson = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // --- API ROUTES ---

  // Health / Connection Check
  if (pathname === '/api/health') {
    if (!pool) {
      return sendJson({ status: 'warning', database: 'No DATABASE_URL configured yet' });
    }
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

  // GET Products
  if (pathname === '/api/products' && req.method === 'GET') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const r = await pool.query('SELECT id, name, category, unit, hsn, gst, purchase_price as "purchasePrice", price, stock FROM products ORDER BY id ASC');
    return sendJson(r.rows);
  }

  // POST Create Product
  if (pathname === '/api/products' && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const b = await getBody(req);
    const q = `INSERT INTO products (name, category, unit, hsn, gst, purchase_price, price, stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
    const r = await pool.query(q, [b.name, b.category, b.unit, b.hsn, b.gst, b.purchasePrice, b.price, b.stock]);
    return sendJson(r.rows[0], 201);
  }

  // POST Adjust Stock
  if (pathname.match(/^\/api\/products\/(\d+)\/adjust-stock$/) && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const id = pathname.split('/')[3];
    const b = await getBody(req);
    const r = await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING *', [parseInt(b.amount || 0), id]);
    return sendJson(r.rows[0]);
  }

  // GET Farmers
  if (pathname === '/api/farmers' && req.method === 'GET') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const r = await pool.query('SELECT id, name, village, phone, outstanding, last_tx as "lastTx" FROM farmers ORDER BY id ASC');
    return sendJson(r.rows);
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

  // POST Save Invoice (Deducts stock automatically & updates Khata if Udhar)
  if (pathname === '/api/invoices' && req.method === 'POST') {
    if (!pool) return sendJson({ error: 'DB not connected' }, 500);
    const b = await getBody(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const invQuery = `
        INSERT INTO invoices (invoice_no, customer_type, customer_name, customer_phone, payment_mode, subtotal, cgst, sgst, grand_total, items)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
      `;
      const invRes = await client.query(invQuery, [
        b.invoiceNo, b.customerType, b.customerName, b.customerPhone,
        b.paymentMode, b.subtotal, b.cgst, b.sgst, b.grandTotal, JSON.stringify(b.items)
      ]);

      // Deduct stock for each item
      for (const item of b.items) {
        await client.query('UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2', [item.qty, item.id]);
      }

      // If Udhar (Credit), update farmer balance
      if (b.paymentMode === 'Credit' && b.customerType === 'khata') {
        const lastTx = `Today (Udhar +₹${b.grandTotal})`;
        await client.query('UPDATE farmers SET outstanding = outstanding + $1, last_tx = $2 WHERE name = $3', [b.grandTotal, lastTx, b.customerName]);
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
