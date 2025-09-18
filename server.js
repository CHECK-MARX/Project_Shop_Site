const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// CVE-2023-1234: Missing security headers and CORS misconfiguration
app.use(cors({
    origin: '*', // CRITICAL: Allows any origin
    credentials: true
}));

// CVE-2023-5678: No rate limiting
// No rate limiting implemented - allows brute force attacks

// CVE-2023-9012: Insecure session configuration
app.use(session({
    secret: 'weak-secret-key', // CRITICAL: Weak session secret
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false, // CRITICAL: Not secure in production
        httpOnly: false, // CRITICAL: Allows XSS to access cookies
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// CVE-2023-3456: No input validation middleware
// Missing input validation and sanitization

// Initialize SQLite database
const db = new sqlite3.Database('shopping.db');

// CVE-2023-7890: SQL Injection vulnerabilities in database setup
db.serialize(() => {
    // Create users table with weak password storage
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT,
        password TEXT,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        price REAL,
        image_path TEXT,
        stock INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create orders table
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        total_price REAL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
    )`);

    // Insert sample data
    const adminPassword = 'admin123'; // CRITICAL: Hardcoded password
    // Store plaintext to align with intentionally vulnerable login query
    const hashedAdminPassword = bcrypt.hashSync(adminPassword, 10);
    
    db.run(`INSERT OR IGNORE INTO users (username, email, password, role) VALUES 
        ('admin', 'admin@shop.com', 'admin123', 'admin'),
        ('user1', 'user1@shop.com', 'password123', 'user')`);

    db.run(`INSERT OR IGNORE INTO products (name, description, price, stock, image_path) VALUES 
        ('Laptop', 'High-performance laptop', 999.99, 10, 'https://picsum.photos/seed/laptop/800/500'),
        ('Smartphone', 'Latest smartphone model', 699.99, 25, 'https://picsum.photos/seed/phone/800/500'),
        ('Headphones', 'Wireless noise-cancelling headphones', 199.99, 50, 'https://picsum.photos/seed/headphones/800/500'),
        ('Anime Hero', '<img src=x onerror=alert(1)>', 59.99, 100, 'https://picsum.photos/seed/hero/800/500'),
        ('Cat Character', 'キュートなキャラクター画像', 39.99, 80, 'https://picsum.photos/seed/cat/800/500')`);

    // Seed additional ~20 cute character items
    db.run(`INSERT OR IGNORE INTO products (name, description, price, stock, image_path) VALUES 
        ('Cute Cat 1', 'かわいいキャラクター01', 19.99, 100, 'https://picsum.photos/seed/cute01/800/500'),
        ('Cute Cat 2', 'かわいいキャラクター02', 19.99, 100, 'https://picsum.photos/seed/cute02/800/500'),
        ('Cute Cat 3', 'かわいいキャラクター03', 19.99, 100, 'https://picsum.photos/seed/cute03/800/500'),
        ('Cute Cat 4', 'かわいいキャラクター04', 19.99, 100, 'https://picsum.photos/seed/cute04/800/500'),
        ('Cute Cat 5', 'かわいいキャラクター05', 19.99, 100, 'https://picsum.photos/seed/cute05/800/500'),
        ('Cute Cat 6', 'かわいいキャラクター06', 19.99, 100, 'https://picsum.photos/seed/cute06/800/500'),
        ('Cute Cat 7', 'かわいいキャラクター07', 19.99, 100, 'https://picsum.photos/seed/cute07/800/500'),
        ('Cute Cat 8', 'かわいいキャラクター08', 19.99, 100, 'https://picsum.photos/seed/cute08/800/500'),
        ('Cute Cat 9', 'かわいいキャラクター09', 19.99, 100, 'https://picsum.photos/seed/cute09/800/500'),
        ('Cute Cat 10', 'かわいいキャラクター10', 19.99, 100, 'https://picsum.photos/seed/cute10/800/500'),
        ('Cute Cat 11', 'かわいいキャラクター11', 19.99, 100, 'https://picsum.photos/seed/cute11/800/500'),
        ('Cute Cat 12', 'かわいいキャラクター12', 19.99, 100, 'https://picsum.photos/seed/cute12/800/500'),
        ('Cute Cat 13', 'かわいいキャラクター13', 19.99, 100, 'https://picsum.photos/seed/cute13/800/500'),
        ('Cute Cat 14', 'かわいいキャラクター14', 19.99, 100, 'https://picsum.photos/seed/cute14/800/500'),
        ('Cute Cat 15', 'かわいいキャラクター15', 19.99, 100, 'https://picsum.photos/seed/cute15/800/500'),
        ('Cute Cat 16', 'かわいいキャラクター16', 19.99, 100, 'https://picsum.photos/seed/cute16/800/500'),
        ('Cute Cat 17', 'かわいいキャラクター17', 19.99, 100, 'https://picsum.photos/seed/cute17/800/500'),
        ('Cute Cat 18', 'かわいいキャラクター18', 19.99, 100, 'https://picsum.photos/seed/cute18/800/500'),
        ('Cute Cat 19', 'かわいいキャラクター19', 19.99, 100, 'https://picsum.photos/seed/cute19/800/500'),
        ('Cute Cat 20', 'かわいいキャラクター20', 19.99, 100, 'https://picsum.photos/seed/cute20/800/500')`);
});

// CVE-2023-1111: SQL Injection in login endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // CRITICAL: Direct SQL injection vulnerability
    const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
    
    db.get(query, (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (user) {
            // CVE-2023-2222: Weak JWT secret
            const token = jwt.sign({ userId: user.id, role: user.role }, 'weak-jwt-secret', { expiresIn: '24h' });
            res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    });
});

// CVE-2023-3333: SQL Injection in user registration
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    
    // CRITICAL: No input validation or sanitization; store plaintext password to keep login vulnerable and functional
    const query = `INSERT INTO users (username, email, password) VALUES ('${username}', '${email}', '${password}')`;
    
    db.run(query, function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Registration failed' });
        }
        res.json({ message: 'User registered successfully', userId: this.lastID });
    });
});

// CVE-2023-4444: SQL Injection in product search
app.get('/api/products', (req, res) => {
    const { search, category } = req.query;
    
    let query = 'SELECT * FROM products WHERE 1=1';
    
    if (search) {
        // CRITICAL: SQL injection in search parameter
        query += ` AND name LIKE '%${search}%'`;
    }
    
    if (category) {
        // CRITICAL: SQL injection in category parameter
        query += ` AND category = '${category}'`;
    }
    
    db.all(query, (err, products) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(products);
    });
});

// CVE-2023-5555: Command Injection vulnerability
app.post('/api/backup', (req, res) => {
    const { backupName } = req.body;
    
    // CRITICAL: Command injection vulnerability
    const command = `cp shopping.db backups/${backupName}.db`;
    
    require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Backup failed' });
        }
        res.json({ message: 'Backup created successfully' });
    });
});

// CVE-2023-6666: Path Traversal vulnerability
app.get('/api/file', (req, res) => {
    const { filename } = req.query;
    
    // CRITICAL: Path traversal vulnerability
    const filePath = path.join(__dirname, 'uploads', filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// CVE-2023-7777: XSS vulnerability in product display
app.get('/api/product/:id', (req, res) => {
    const productId = req.params.id;
    
    // CRITICAL: No input validation
    const query = `SELECT * FROM products WHERE id = ${productId}`;
    
    db.get(query, (err, product) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (product) {
            // CRITICAL: XSS vulnerability - no output encoding
            res.json(product);
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    });
});

// CVE-2023-8888: CSRF vulnerability - no CSRF protection
app.post('/api/order', (req, res) => {
    const { productId, quantity, userId } = req.body;
    
    // CRITICAL: No CSRF token validation
    const query = `INSERT INTO orders (user_id, product_id, quantity, total_price) 
                   SELECT ${userId}, ${productId}, ${quantity}, (price * ${quantity}) 
                   FROM products WHERE id = ${productId}`;
    
    db.run(query, function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Order failed' });
        }
        res.json({ message: 'Order placed successfully', orderId: this.lastID });
    });
});

// Vulnerable checkout endpoint: stores raw card data and reflects input
app.post('/api/checkout', (req, res) => {
    const { name, cardNumber, expiry, cvv, total } = req.body;
    // CRITICAL: No validation, logs sensitive data, stores plaintext
    console.log('Payment info:', req.body);
    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        card_number TEXT,
        expiry TEXT,
        cvv TEXT,
        total REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const q = `INSERT INTO payments (name, card_number, expiry, cvv, total) VALUES ('${name}', '${cardNumber}', '${expiry}', '${cvv}', ${total})`;
    db.run(q, function(err){
        if (err) { return res.status(500).json({ error: 'Checkout error' }); }
        return res.json({ ok: true, name, total });
    });
});

// CVE-2023-9999: Information disclosure - debug endpoint
app.get('/api/debug', (req, res) => {
    // CRITICAL: Debug endpoint exposes sensitive information
    res.json({
        environment: process.env,
        database: 'shopping.db',
        version: '1.0.0',
        debug: true
    });
});

// CVE-2023-0001: Weak authentication bypass
app.get('/api/admin/users', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        // CRITICAL: Weak JWT verification
        const decoded = jwt.verify(token, 'weak-jwt-secret');
        
        if (decoded.role === 'admin') {
            // CRITICAL: Exposes all user data including passwords
            db.all('SELECT * FROM users', (err, users) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json(users);
            });
        } else {
            res.status(403).json({ error: 'Access denied' });
        }
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Vulnerable shopping site running on port ${PORT}`);
    console.log('WARNING: This site contains intentional vulnerabilities for educational purposes only!');
});
